/**
 * Tray-window root for the ClipForge desktop app.
 *
 * Owns the panel-level state (which sub-panel is open, copy-state badge,
 * open animation, last-action / last-run cache) and wires it to the
 * compactor + clipboard hooks. All visuals are delegated to the small
 * stateless sub-components in this folder; long-running side effects
 * live in {@link useTauriShortcuts} & friends.
 */

import { type FC, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useClipboard } from '../hooks/useClipboard';
import { useCompactor } from '../hooks/useCompactor';
import type { CompactorRunResult } from '../hooks/useCompactor';
import { useHistoryStore } from '../stores/historyStore';
import type { HistoryEntry } from '../stores/historyStore';
import { useSettingsStore } from '../stores/settingsStore';
import { MenuBarBottomGrid } from './MenuBarBottomGrid';
import { MenuBarCommandCard } from './MenuBarCommandCard';
import { MenuBarEditorGrid } from './MenuBarEditorGrid';
import { MenuBarToolbar } from './MenuBarToolbar';
import {
  COPY_STATE_RESET_MS,
  MENU_BAR_OPEN_DURATION_MS,
  type Panel,
  type TransformAction,
} from './menu-bar-constants';
import {
  deriveCommandCopy,
  deriveOutputMeta,
  deriveSourceMeta,
  isMacOSPlatform,
} from './menu-bar-helpers';
import {
  useClipboardAutoWatch,
  useMenuBarShellListeners,
  useTauriShortcuts,
} from './use-menu-bar-shortcuts';

// Overlay panels are only rendered on demand (gear / clock click). Loading
// them lazily keeps the initial tray paint snappy and lets rolldown emit
// dedicated chunks for each one.
const HistoryPanel = lazy(() => import('./HistoryPanel'));
const SettingsPanel = lazy(() => import('./SettingsPanel'));

/**
 * The tray panel. Renders one of three views: main workspace,
 * settings overlay, or history overlay.
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

  const [panel, setPanel] = useState<Panel>('main');
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

  // ---- derived display state -----------------------------------------

  const activeLayerCodes = useMemo(
    () =>
      [
        layers.structural ? 'L1' : null,
        layers.dictionary ? 'L2' : null,
        layers.tokenizerAware ? 'L3' : null,
        layers.semantic ? 'L4' : null,
      ].filter(Boolean) as string[],
    [layers],
  );
  // A run is lossless unless the semantic layer ran and reported otherwise.
  const runIsLossless = lastRun?.reversible ?? !layers.semantic;

  const { title: commandTitle, body: commandCopy } = deriveCommandCopy({
    isProcessing: compactor.isProcessing,
    hasOutput,
    outputHasError,
    lastAction,
  });
  const sourceMeta = deriveSourceMeta(Boolean(clipboard.content));
  const outputMeta = deriveOutputMeta(hasOutput, outputHasError);

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
          onOpenHistory={() => setPanel('history')}
          onOpenSettings={() => setPanel('settings')}
        />

        <div className="desktop-content">
          <MenuBarCommandCard
            title={commandTitle}
            body={commandCopy}
            isProcessing={compactor.isProcessing}
            hasInput={compactor.input.trim().length > 0}
            hasOutput={hasOutput}
            outputHasError={outputHasError}
            format={compactor.format}
            output={compactor.output}
            model={model}
            activeLayerCodes={activeLayerCodes}
            showSemanticBudget={layers.semantic}
            semanticBudget={semanticBudget}
            runIsLossless={runIsLossless}
            packHotkey={packHotkey}
            restoreHotkey={restoreHotkey}
            savings={compactor.savings}
            onRead={() => void clipboard.readClipboard()}
            onCompress={() => {
              handleCompress();
            }}
            onRestore={() => {
              handleRestore();
            }}
          />

          <MenuBarEditorGrid
            input={compactor.input}
            format={compactor.format}
            output={compactor.output}
            originalTokens={compactor.originalTokens}
            compressedTokens={compactor.compressedTokens}
            sourceMeta={sourceMeta}
            outputMeta={outputMeta}
            lastAction={lastAction}
            autoCompress={autoCompress}
            sourceTextareaRef={sourceTextareaRef}
            onSourceChange={setSourceText}
            onPasteClipboard={() => void clipboard.readClipboard()}
            hasOutput={hasOutput}
            outputHasError={outputHasError}
            outputFormat={outputFormat}
            copyState={copyState}
            runIsLossless={runIsLossless}
            onOutputFormatChange={setOutputFormat}
            onCopyOutput={() => void handleCopy()}
          />

          <MenuBarBottomGrid
            autoCompress={autoCompress}
            onToggleAutoCompress={() => setAutoCompress(!autoCompress)}
            model={model}
            outputFormat={outputFormat}
            originalTokens={compactor.originalTokens}
            compressedTokens={compactor.compressedTokens}
            compressibilityLabel={compactor.compressibilityLabel}
          />
        </div>
      </div>
    </div>
  );
};

export default MenuBarPanel;
