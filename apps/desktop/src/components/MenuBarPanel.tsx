/**
 * Tray-window root for the ClipForge desktop app.
 *
 * Owns the panel-level state (active primary tab, which overlay is open,
 * copy-state badge, open animation, last-action / last-run cache) and
 * wires it to the compactor + clipboard hooks. The primary surface is
 * the Telemetry HQ tab (token savings from pakt's MCP/CLI stats files);
 * the clipboard compress workspace lives on the second tab. All visuals
 * are delegated to the small stateless sub-components in this folder;
 * long-running side effects live in {@link useTauriShortcuts} & friends.
 */

import { type FC, Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useClipboard } from '../hooks/useClipboard';
import { useCompactor } from '../hooks/useCompactor';
import type { CompactorRunResult } from '../hooks/useCompactor';
import { useHistoryStore } from '../stores/historyStore';
import type { HistoryEntry } from '../stores/historyStore';
import { useSettingsStore } from '../stores/settingsStore';
import { CompressWorkspace } from './CompressWorkspace';
import { MenuBarToolbar } from './MenuBarToolbar';
import {
  COPY_STATE_RESET_MS,
  MENU_BAR_OPEN_DURATION_MS,
  type MainTab,
  type Panel,
  type TransformAction,
} from './menu-bar-constants';
import { isMacOSPlatform } from './menu-bar-helpers';
import {
  useClipboardAutoWatch,
  useMenuBarShellListeners,
  useTauriShortcuts,
} from './use-menu-bar-shortcuts';

// Overlay panels and the telemetry tab are only rendered on demand.
// Loading them lazily keeps the initial tray paint snappy and lets
// rolldown emit dedicated chunks for each one.
const HistoryPanel = lazy(() => import('./HistoryPanel'));
const SettingsPanel = lazy(() => import('./SettingsPanel'));
const TelemetryPanel = lazy(() => import('./TelemetryPanel'));

/**
 * The tray panel. Renders the main view (telemetry HQ or compress
 * workspace, switched by the toolbar tabs) plus the settings and
 * history overlays on demand.
 */
const MenuBarPanel: FC = () => {
  const compactor = useCompactor();
  const clipboard = useClipboard();
  const layers = useSettingsStore((s) => s.layers);
  const model = useSettingsStore((s) => s.model);
  const semanticBudget = useSettingsStore((s) => s.semanticBudget);
  const outputFormat = useSettingsStore((s) => s.outputFormat);
  const setOutputFormat = useSettingsStore((s) => s.setOutputFormat);
  const autoCompress = useSettingsStore((s) => s.autoCompress);
  const setAutoCompress = useSettingsStore((s) => s.setAutoCompress);
  const historyEnabled = useSettingsStore((s) => s.historyEnabled);
  const addEntry = useHistoryStore((s) => s.addEntry);
  const hydrateHistory = useHistoryStore((s) => s.hydrate);

  const [panel, setPanel] = useState<Panel>('main');
  // Telemetry HQ is the primary surface; the compress workspace is tab #2.
  const [mainTab, setMainTab] = useState<MainTab>('telemetry');
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const [isOpening, setIsOpening] = useState(false);
  const [lastAction, setLastAction] = useState<TransformAction>(null);
  const [lastRun, setLastRun] = useState<CompactorRunResult | null>(null);

  // Refs that persist across renders without triggering re-renders.
  const suppressedClipboardTextRef = useRef<string | null>(null);
  const sourceTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const openAnimationTimeoutRef = useRef<number | null>(null);
  const copyStateTimeoutRef = useRef<number | null>(null);

  const isMacOS = isMacOSPlatform();
  const packHotkey = isMacOS ? '⌘⇧C' : 'Ctrl+Shift+C';
  const restoreHotkey = isMacOS ? '⌘⇧R' : 'Ctrl+Shift+R';

  // ---- input + animation helpers --------------------------------------

  const setSourceText = useCallback(
    (text: string) => {
      // Replacing the source invalidates any prior packed/restored output.
      setLastAction(null);
      setLastRun(null);
      compactor.setInput(text);
    },
    [compactor],
  );

  const triggerOpenAnimation = useCallback((focusSource = false) => {
    if (typeof window === 'undefined') return;

    if (openAnimationTimeoutRef.current != null) {
      window.clearTimeout(openAnimationTimeoutRef.current);
    }

    setIsOpening(false);

    // RAF gate so the class actually toggles off → on between frames.
    window.requestAnimationFrame(() => {
      setIsOpening(true);
      openAnimationTimeoutRef.current = window.setTimeout(() => {
        setIsOpening(false);
      }, MENU_BAR_OPEN_DURATION_MS);

      if (focusSource) {
        // Defer focus so the textarea is mounted/visible.
        window.setTimeout(() => {
          sourceTextareaRef.current?.focus();
          sourceTextareaRef.current?.setSelectionRange(
            sourceTextareaRef.current.value.length,
            sourceTextareaRef.current.value.length,
          );
        }, 120);
      }
    });
  }, []);

  // Cleanup any pending timers when the panel unmounts.
  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') return;
      if (openAnimationTimeoutRef.current != null) {
        window.clearTimeout(openAnimationTimeoutRef.current);
      }
      if (copyStateTimeoutRef.current != null) {
        window.clearTimeout(copyStateTimeoutRef.current);
      }
    };
  }, []);

  // Read clipboard once on mount; subsequent reads are user-driven.
  useEffect(() => {
    void clipboard.readClipboard();
  }, [clipboard.readClipboard]);

  // Load persisted history from SQLite once on mount (no-op outside Tauri).
  useEffect(() => {
    void hydrateHistory();
  }, [hydrateHistory]);

  // Mirror clipboard reads into the source textarea.
  useEffect(() => {
    if (clipboard.content) {
      setSourceText(clipboard.content);
    }
  }, [clipboard.content, setSourceText]);

  // ---- transform handlers --------------------------------------------

  const recordHistory = useCallback(
    (result: CompactorRunResult | null) => {
      if (!historyEnabled || !result) return result;
      addEntry({
        input: result.input,
        output: result.output,
        format: result.format,
        savedTokens: result.originalTokens - result.compressedTokens,
      });
      return result;
    },
    [historyEnabled, addEntry],
  );

  const cacheTarget = useSettingsStore((s) => s.cacheTarget);
  const handleCompress = useCallback(
    (sourceText?: string) => {
      const result = recordHistory(
        compactor.compress(
          {
            layers,
            fromFormat: undefined,
            targetModel: model,
            ...(cacheTarget ? { target: cacheTarget } : {}),
          },
          sourceText,
        ),
      );
      if (result) {
        setLastAction('compress');
        setLastRun(result);
      }
      return result;
    },
    [compactor, layers, model, cacheTarget, recordHistory],
  );

  const hasOutput = compactor.output.trim().length > 0;
  const outputHasError = hasOutput && compactor.output.startsWith('Error:');

  const handleRestore = useCallback(
    (sourceText?: string) => {
      // If the user just packed something successfully, default the
      // restore source to that packed output.
      const effectiveSource =
        sourceText ??
        (lastAction === 'compress' && hasOutput && !outputHasError ? compactor.output : undefined);

      const result = recordHistory(compactor.decompress(outputFormat, effectiveSource, model));
      if (result) {
        setLastAction('decompress');
        setLastRun(result);
      }
      return result;
    },
    [compactor, hasOutput, lastAction, model, outputFormat, outputHasError, recordHistory],
  );

  // ---- clipboard / copy-state plumbing -------------------------------

  const setTimedCopyState = useCallback((state: 'success' | 'error') => {
    setCopyState(state);
    if (typeof window === 'undefined') return;

    if (copyStateTimeoutRef.current != null) {
      window.clearTimeout(copyStateTimeoutRef.current);
    }

    copyStateTimeoutRef.current = window.setTimeout(() => {
      setCopyState('idle');
      copyStateTimeoutRef.current = null;
    }, COPY_STATE_RESET_MS);
  }, []);

  const writeResultToClipboard = useCallback(
    async (output: string) => {
      const success = await clipboard.writeClipboard(output);
      if (success) {
        // Suppress the next auto-watch event; it would otherwise loop.
        suppressedClipboardTextRef.current = output;
      }
      setTimedCopyState(success ? 'success' : 'error');
      return success;
    },
    [clipboard, setTimedCopyState],
  );

  const runClipboardShortcut = useCallback(
    async (transform: (text: string) => CompactorRunResult | null) => {
      const text = (await clipboard.readClipboard()) ?? compactor.input;
      if (!text?.trim()) return;
      const result = transform(text);
      if (result) {
        await writeResultToClipboard(result.output);
      }
    },
    [clipboard, compactor.input, writeResultToClipboard],
  );

  const handleCopy = useCallback(async () => {
    if (!compactor.output) return;
    await writeResultToClipboard(compactor.output);
  }, [compactor.output, writeResultToClipboard]);

  const handleHistorySelect = useCallback(
    (entry: HistoryEntry) => {
      setSourceText(entry.input);
      setPanel('main');
      // History entries feed the source editor, so land on the compress tab.
      setMainTab('compress');
      triggerOpenAnimation(true);
    },
    [setSourceText, triggerOpenAnimation],
  );

  // ---- Tauri-side effects (extracted) --------------------------------

  const shortcutDeps = {
    autoCompress,
    panel,
    setPanel,
    setAutoCompress,
    triggerOpenAnimation,
    handleCompress,
    handleRestore,
    runClipboardShortcut,
    suppressedClipboardTextRef,
  };
  useTauriShortcuts(shortcutDeps);
  useClipboardAutoWatch(shortcutDeps);
  useMenuBarShellListeners(shortcutDeps);

  // ---- render --------------------------------------------------------

  return (
    <div className="desktop-frame">
      <div className={`desktop-shell ${isOpening ? 'is-opening' : ''}`}>
        {/* Suspense fallback is intentionally empty — the shell stays visible
            while the overlay chunk loads, which is effectively instant on
            disk-cached fetches. */}
        <Suspense fallback={null}>
          {panel === 'settings' && <SettingsPanel onClose={() => setPanel('main')} />}
          {panel === 'history' && (
            <HistoryPanel
              onSelect={handleHistorySelect}
              onClose={() => setPanel('main')}
              onOpenSettings={() => setPanel('settings')}
            />
          )}
        </Suspense>

        <MenuBarToolbar
          autoCompress={autoCompress}
          historyEnabled={historyEnabled}
          activeTab={mainTab}
          onTabChange={setMainTab}
          onOpenHistory={() => setPanel('history')}
          onOpenSettings={() => setPanel('settings')}
        />

        <div className="desktop-content">
          {mainTab === 'telemetry' ? (
            <div
              id="tabpanel-telemetry"
              role="tabpanel"
              aria-labelledby="tab-telemetry"
              className="desktop-tabpanel"
            >
              {/* Same empty Suspense fallback as the overlays — the shell
                  stays visible while the telemetry chunk loads. */}
              <Suspense fallback={null}>
                <TelemetryPanel />
              </Suspense>
            </div>
          ) : (
            <div
              id="tabpanel-compress"
              role="tabpanel"
              aria-labelledby="tab-compress"
              className="desktop-tabpanel"
            >
              <CompressWorkspace
                compactor={compactor}
                clipboardHasContent={Boolean(clipboard.content)}
                layers={layers}
                model={model}
                semanticBudget={semanticBudget}
                outputFormat={outputFormat}
                autoCompress={autoCompress}
                copyState={copyState}
                lastAction={lastAction}
                lastRun={lastRun}
                packHotkey={packHotkey}
                restoreHotkey={restoreHotkey}
                sourceTextareaRef={sourceTextareaRef}
                onSourceChange={setSourceText}
                onReadClipboard={() => void clipboard.readClipboard()}
                onCompress={() => {
                  handleCompress();
                }}
                onRestore={() => {
                  handleRestore();
                }}
                onCopyOutput={() => void handleCopy()}
                onOutputFormatChange={setOutputFormat}
                onToggleAutoCompress={() => setAutoCompress(!autoCompress)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MenuBarPanel;
