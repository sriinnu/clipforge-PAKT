import type { PaktFormat } from '@sriinnu/pakt';
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clipforgeMark from '../../../../assets/clipforge-mark.svg';
import { useClipboard } from '../hooks/useClipboard';
import { useCompactor } from '../hooks/useCompactor';
import type { CompactorRunResult } from '../hooks/useCompactor';
import { useHistoryStore } from '../stores/historyStore';
import type { HistoryEntry } from '../stores/historyStore';
import { useSettingsStore } from '../stores/settingsStore';
import FormatBadge from './FormatBadge';
import HistoryPanel from './HistoryPanel';
import LayerControls from './LayerControls';
import SettingsPanel from './SettingsPanel';
import TokenBar from './TokenBar';

const OUTPUT_FORMATS: { value: PaktFormat; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'csv', label: 'CSV' },
  { value: 'markdown', label: 'MD' },
  { value: 'text', label: 'Text' },
];

type Panel = 'main' | 'settings' | 'history';
type TransformAction = 'compress' | 'decompress' | null;

const MENU_BAR_OPEN_DURATION_MS = 220;
const COPY_STATE_RESET_MS = 1500;

const MenuBarPanel: FC = () => {
  const compactor = useCompactor();
  const clipboard = useClipboard();
  const layers = useSettingsStore((s) => s.layers);
  const model = useSettingsStore((s) => s.model);
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
  const suppressedClipboardTextRef = useRef<string | null>(null);
  const sourceTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const openAnimationTimeoutRef = useRef<number | null>(null);
  const copyStateTimeoutRef = useRef<number | null>(null);
  const isMacOS =
    typeof navigator !== 'undefined' &&
    /(Mac|iPhone|iPad)/i.test(`${navigator.platform} ${navigator.userAgent}`);

  const packHotkey = isMacOS ? '⌘⇧C' : 'Ctrl+Shift+C';
  const restoreHotkey = isMacOS ? '⌘⇧R' : 'Ctrl+Shift+R';

  const setSourceText = useCallback(
    (text: string) => {
      setLastAction(null);
      compactor.setInput(text);
    },
    [compactor],
  );

  const triggerOpenAnimation = useCallback((focusSource = false) => {
    if (typeof window === 'undefined') {
      return;
    }

    if (openAnimationTimeoutRef.current != null) {
      window.clearTimeout(openAnimationTimeoutRef.current);
    }

    setIsOpening(false);

    window.requestAnimationFrame(() => {
      setIsOpening(true);
      openAnimationTimeoutRef.current = window.setTimeout(() => {
        setIsOpening(false);
      }, MENU_BAR_OPEN_DURATION_MS);

      if (focusSource) {
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

  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') {
        return;
      }

      if (openAnimationTimeoutRef.current != null) {
        window.clearTimeout(openAnimationTimeoutRef.current);
      }

      if (copyStateTimeoutRef.current != null) {
        window.clearTimeout(copyStateTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void clipboard.readClipboard();
  }, [clipboard.readClipboard]);

  useEffect(() => {
    if (clipboard.content) {
      setSourceText(clipboard.content);
    }
  }, [clipboard.content, setSourceText]);

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

  const handleCompress = useCallback(
    (sourceText?: string) => {
      const result = recordHistory(
        compactor.compress(
          {
            layers,
            fromFormat: undefined,
            targetModel: model,
          },
          sourceText,
        ),
      );

      if (result) {
        setLastAction('compress');
      }

      return result;
    },
    [compactor, layers, model, recordHistory],
  );

  const hasOutput = compactor.output.trim().length > 0;
  const outputHasError = hasOutput && compactor.output.startsWith('Error:');

  const handleRestore = useCallback(
    (sourceText?: string) => {
      const effectiveSource =
        sourceText ??
        (lastAction === 'compress' && hasOutput && !outputHasError ? compactor.output : undefined);

      const result = recordHistory(compactor.decompress(outputFormat, effectiveSource, model));

      if (result) {
        setLastAction('decompress');
      }

      return result;
    },
    [compactor, hasOutput, lastAction, model, outputFormat, outputHasError, recordHistory],
  );

  const setTimedCopyState = useCallback((state: 'success' | 'error') => {
    setCopyState(state);

    if (typeof window === 'undefined') {
      return;
    }

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

  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;

    async function setupShortcutListeners() {
      if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;

      const [{ listen }, { invoke }] = await Promise.all([
        import('@tauri-apps/api/event'),
        import('@tauri-apps/api/core'),
      ]);

      if (!active) return;

      const unlisteners = await Promise.all([
        listen('shortcut-compress', () => void runClipboardShortcut(handleCompress)),
        listen('shortcut-decompress', () => void runClipboardShortcut(handleRestore)),
        listen('shortcut-history', () => {
          setPanel('history');
        }),
        listen('shortcut-toggle-auto', () => {
          setAutoCompress(!autoCompress);
        }),
        listen('open-settings', () => {
          setPanel('settings');
        }),
      ]);

      cleanup = () => {
        for (const unlisten of unlisteners) {
          unlisten();
        }
      };

      void invoke('stop_clipboard_watch').catch(() => {});
    }

    void setupShortcutListeners();

    return () => {
      active = false;
      cleanup?.();
    };
  }, [autoCompress, handleCompress, handleRestore, runClipboardShortcut, setAutoCompress]);

  useEffect(() => {
    let active = true;
    let stopWatcher: (() => void) | undefined;

    async function setupClipboardWatch() {
      if (!autoCompress) return;
      if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;

      const [{ listen }, { invoke }] = await Promise.all([
        import('@tauri-apps/api/event'),
        import('@tauri-apps/api/core'),
      ]);

      await invoke('start_clipboard_watch');
      const unlisten = await listen<string>('clipboard-changed', (event) => {
        if (!active || !event.payload.trim()) return;
        if (event.payload === suppressedClipboardTextRef.current) {
          suppressedClipboardTextRef.current = null;
          return;
        }
        handleCompress(event.payload);
      });

      stopWatcher = () => {
        unlisten();
        void invoke('stop_clipboard_watch').catch(() => {});
      };
    }

    void setupClipboardWatch();

    return () => {
      active = false;
      stopWatcher?.();
    };
  }, [autoCompress, handleCompress]);

  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;

    async function setupShellListeners() {
      if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;

      const [{ listen }, { getCurrentWindow }] = await Promise.all([
        import('@tauri-apps/api/event'),
        import('@tauri-apps/api/window'),
      ]);

      if (!active) return;

      const appWindow = getCurrentWindow();
      const unlisten = await listen('panel-opened', () => {
        triggerOpenAnimation(panel === 'main');
      });

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;

        if (panel !== 'main') {
          setPanel('main');
          triggerOpenAnimation(true);
          return;
        }

        void appWindow.hide();
      };

      window.addEventListener('keydown', handleKeyDown);

      cleanup = () => {
        unlisten();
        window.removeEventListener('keydown', handleKeyDown);
      };
    }

    void setupShellListeners();

    return () => {
      active = false;
      cleanup?.();
    };
  }, [panel, triggerOpenAnimation]);

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

  const commandTitle = compactor.isProcessing
    ? 'Transforming the current payload'
    : outputHasError
      ? 'The latest output needs attention'
      : hasOutput
        ? 'Packed output is ready'
        : 'Clipboard workspace is ready';
  const commandCopy = compactor.isProcessing
    ? 'The active transform is running inside the tray shell.'
    : outputHasError
      ? 'Adjust the source or restore format, then run the next action.'
      : lastAction === 'compress'
        ? 'Copy the packed result or restore it directly from this panel.'
        : 'Pull the clipboard in, inspect it, then pack or restore as needed.';
  const sourceMeta = clipboard.content
    ? 'Loaded from the clipboard.'
    : 'Paste JSON, YAML, CSV, Markdown, or text.';
  const outputMeta = outputHasError
    ? 'The output area contains the latest error.'
    : hasOutput
      ? 'Copy the result or restore it into the selected format.'
      : 'Packed or restored output appears here.';

  return (
    <div className="desktop-frame">
      <div className={`desktop-shell ${isOpening ? 'is-opening' : ''}`}>
        {panel === 'settings' && <SettingsPanel onClose={() => setPanel('main')} />}
        {panel === 'history' && (
          <HistoryPanel
            onSelect={handleHistorySelect}
            onClose={() => setPanel('main')}
            onOpenSettings={() => setPanel('settings')}
          />
        )}

        <div className="desktop-toolbar">
          <div className="desktop-toolbar-left">
            <div className="desktop-brand">
              <div className="desktop-brand-mark">
                <img src={clipforgeMark} alt="" className="desktop-brand-mark-image" />
              </div>
              <div className="desktop-brand-copy">
                <h1 className="desktop-brand-title">ClipForge</h1>
                <p className="desktop-brand-subtitle">Structured clipboard packer</p>
              </div>
            </div>
          </div>
          <div className="desktop-toolbar-actions">
            <div className="desktop-toolbar-pills">
              <span className="desktop-toolbar-pill">{autoCompress ? 'Watch' : 'Manual'}</span>
              <span className="desktop-toolbar-pill">{historyEnabled ? 'History' : 'Private'}</span>
            </div>
            <button
              type="button"
              onClick={() => setPanel('history')}
              title="History"
              className="desktop-icon-button"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <title>History</title>
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setPanel('settings')}
              title="Settings"
              className="desktop-icon-button"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <title>Settings</title>
                <path
                  fillRule="evenodd"
                  d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.2.966.46 1.397.772l1.4-.56a1 1 0 011.12.32l.68 1.178a1 1 0 01-.14 1.124l-1.107.913c.048.514.048 1.033 0 1.547l1.107.913a1 1 0 01.14 1.124l-.68 1.178a1 1 0 01-1.12.32l-1.4-.56c-.43.312-.9.572-1.397.772l-.295 1.473a1 1 0 01-.98.804H9.32a1 1 0 01-.98-.804l-.295-1.473a5.957 5.957 0 01-1.397-.772l-1.4.56a1 1 0 01-1.12-.32l-.68-1.178a1 1 0 01.14-1.124l1.107-.913a5.93 5.93 0 010-1.547L3.587 7.87a1 1 0 01-.14-1.124l.68-1.178a1 1 0 011.12-.32l1.4.56c.43-.312.9-.572 1.397-.772l.295-1.473zM10 13a3 3 0 100-6 3 3 0 000 6z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="desktop-content">
          <section className="desktop-command-card">
            <div className="desktop-command-row">
              <div className="desktop-command-copy">
                <p className="desktop-card-title">Quick Actions</p>
                <h2 className="desktop-command-title">{commandTitle}</h2>
                <p className="desktop-copy">{commandCopy}</p>
              </div>
              <div className="desktop-command-actions">
                <button
                  type="button"
                  onClick={() => void clipboard.readClipboard()}
                  className="desktop-secondary-button"
                >
                  Read
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleCompress();
                  }}
                  disabled={compactor.isProcessing || !compactor.input.trim()}
                  className="desktop-primary-button"
                >
                  Pack
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleRestore();
                  }}
                  disabled={compactor.isProcessing || !compactor.input.trim()}
                  className="desktop-secondary-button"
                >
                  Restore
                </button>
              </div>
            </div>

            <div className="desktop-chip-row">
              <FormatBadge format={compactor.format} />
              <span className="desktop-hero-chip">{model}</span>
              <span className="desktop-hero-chip">
                {activeLayerCodes.length > 0 ? activeLayerCodes.join(' · ') : 'No layers'}
              </span>
              <span className="desktop-hero-chip">Pack {packHotkey}</span>
              <span className="desktop-hero-chip">Restore {restoreHotkey}</span>
              {hasOutput && !outputHasError ? (
                <span className="desktop-hero-chip is-strong">{compactor.savings}% saved</span>
              ) : null}
              {outputHasError ? <span className="desktop-hero-chip is-danger">Fix output</span> : null}
            </div>
          </section>

          <div className="desktop-editor-grid">
            <section className="desktop-card">
              <div className="desktop-card-inner">
                <div className="desktop-card-header">
                  <div>
                    <div className="desktop-card-title-row">
                      <p className="desktop-card-title">Source</p>
                      <span className="desktop-card-meta">
                        {compactor.originalTokens.toLocaleString()} tokens
                      </span>
                    </div>
                    <p className="desktop-copy">{sourceMeta}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void clipboard.readClipboard()}
                    className="desktop-inline-action"
                  >
                    Paste clipboard
                  </button>
                </div>

                <textarea
                  ref={sourceTextareaRef}
                  value={compactor.input}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder="Paste or type content here..."
                  rows={11}
                  className="desktop-editor"
                  aria-label="Source content"
                />

                <div className="desktop-status-line">
                  <div className="desktop-inline-metrics">
                    <FormatBadge format={compactor.format} />
                    <span className="desktop-card-meta">
                      {lastAction === 'compress' ? 'Packed output is current' : 'Source is current'}
                    </span>
                  </div>
                  <span>{autoCompress ? 'Watching clipboard' : 'Manual mode'}</span>
                </div>
              </div>
            </section>

            <section className="desktop-card">
              <div className="desktop-card-inner">
                <div className="desktop-card-header desktop-card-header-stack">
                  <div>
                    <div className="desktop-card-title-row">
                      <p className="desktop-card-title">Output</p>
                      {hasOutput ? (
                        <span className="desktop-card-meta">
                          {compactor.compressedTokens.toLocaleString()} tokens
                        </span>
                      ) : null}
                    </div>
                    <p className="desktop-copy">{outputMeta}</p>
                  </div>
                  <div className="desktop-status-actions">
                    <select
                      value={outputFormat}
                      onChange={(e) => setOutputFormat(e.target.value as PaktFormat)}
                      className="desktop-select desktop-inline-select"
                      aria-label="Output format"
                    >
                      {OUTPUT_FORMATS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    {!outputHasError && hasOutput ? (
                      <button type="button" onClick={() => void handleCopy()} className="desktop-primary-button">
                        Copy output
                      </button>
                    ) : null}
                  </div>
                </div>

                <textarea
                  value={compactor.output}
                  readOnly
                  placeholder="Output will appear here..."
                  rows={11}
                  className="desktop-editor"
                  aria-label="Output content"
                />

                <div className="desktop-status-line">
                  <span>
                    {outputHasError
                      ? 'Review the error message above.'
                      : hasOutput
                        ? 'Output is ready for copy or restore.'
                        : 'No output yet.'}
                  </span>
                  {hasOutput ? (
                    <span className={`desktop-copy-badge ${copyState}`}>
                      {copyState === 'success'
                        ? 'Copied'
                        : copyState === 'error'
                          ? 'Clipboard failed'
                          : outputHasError
                            ? 'Needs review'
                            : 'Ready'}
                    </span>
                  ) : null}
                </div>
              </div>
            </section>
          </div>

          <div className="desktop-bottom-grid">
            <LayerControls />

            <div className="desktop-side-stack">
              <section className="desktop-card">
                <div className="desktop-card-inner desktop-utility-grid">
                  <div className="desktop-utility-item">
                    <span className="desktop-section-title">Clipboard Watch</span>
                    <div className="desktop-utility-toggle-row">
                      <span className="desktop-utility-value">{autoCompress ? 'Enabled' : 'Disabled'}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={autoCompress}
                        onClick={() => setAutoCompress(!autoCompress)}
                        className={`desktop-toggle ${autoCompress ? 'is-on' : ''}`}
                      >
                        <span className="desktop-toggle-thumb" />
                      </button>
                    </div>
                  </div>

                  <div className="desktop-utility-item">
                    <span className="desktop-section-title">Token Model</span>
                    <span className="desktop-utility-value">{model}</span>
                  </div>

                  <div className="desktop-utility-item">
                    <span className="desktop-section-title">Restore Format</span>
                    <span className="desktop-utility-value">{outputFormat.toUpperCase()}</span>
                  </div>
                </div>
              </section>

              <TokenBar
                originalTokens={compactor.originalTokens}
                compressedTokens={compactor.compressedTokens}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MenuBarPanel;
