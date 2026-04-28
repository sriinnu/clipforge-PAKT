/**
 * Tauri-side side effects for the menu bar panel:
 * - global shortcut listeners (compress / decompress / history / toggle / settings)
 * - clipboard auto-watch when `autoCompress` is on
 * - panel-opened / Escape-key handling
 *
 * Extracted into a custom hook so {@link MenuBarPanel} stays under the
 * 450-LOC cap. Behavior is intentionally identical to the previous
 * inline `useEffect` blocks.
 */

import { type MutableRefObject, useEffect } from 'react';
import type { CompactorRunResult } from '../hooks/useCompactor';
import type { Panel } from './menu-bar-constants';

/**
 * Imperative callbacks the hook needs from the parent. Grouped to keep
 * the signature manageable and to make the dependency surface explicit.
 */
export interface MenuBarShortcutDeps {
  autoCompress: boolean;
  panel: Panel;
  setPanel: (panel: Panel) => void;
  setAutoCompress: (value: boolean) => void;
  triggerOpenAnimation: (focusSource?: boolean) => void;
  handleCompress: (sourceText?: string) => CompactorRunResult | null;
  handleRestore: (sourceText?: string) => CompactorRunResult | null;
  runClipboardShortcut: (transform: (text: string) => CompactorRunResult | null) => Promise<void>;
  /** When set, the next auto-watch event matching this string is ignored. */
  suppressedClipboardTextRef: MutableRefObject<string | null>;
}

/* True only when running inside a Tauri webview shell. */
function inTauriShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Wire up the Tauri global-shortcut listeners. The hook re-binds every
 * time `autoCompress` or any of the imperative callbacks change so the
 * captured closures always see fresh state.
 */
export function useTauriShortcuts(deps: MenuBarShortcutDeps): void {
  const {
    autoCompress,
    setPanel,
    setAutoCompress,
    handleCompress,
    handleRestore,
    runClipboardShortcut,
  } = deps;

  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;

    async function setupShortcutListeners() {
      if (!inTauriShell()) return;

      const [{ listen }, { invoke }] = await Promise.all([
        import('@tauri-apps/api/event'),
        import('@tauri-apps/api/core'),
      ]);

      if (!active) return;

      const unlisteners = await Promise.all([
        listen('shortcut-compress', () => void runClipboardShortcut(handleCompress)),
        listen('shortcut-decompress', () => void runClipboardShortcut(handleRestore)),
        listen('shortcut-history', () => setPanel('history')),
        listen('shortcut-toggle-auto', () => setAutoCompress(!autoCompress)),
        listen('open-settings', () => setPanel('settings')),
      ]);

      cleanup = () => {
        for (const unlisten of unlisteners) {
          unlisten();
        }
      };

      // Pause clipboard watch when shortcuts re-bind so we don't double-fire.
      void invoke('stop_clipboard_watch').catch(() => {});
    }

    void setupShortcutListeners();

    return () => {
      active = false;
      cleanup?.();
    };
  }, [
    autoCompress,
    handleCompress,
    handleRestore,
    runClipboardShortcut,
    setAutoCompress,
    setPanel,
  ]);
}

/**
 * Subscribe to Tauri clipboard-changed events when `autoCompress` is on.
 * Each new clipboard string runs through `handleCompress` unless it
 * matches the most recently emitted output (which would loop).
 */
export function useClipboardAutoWatch(deps: MenuBarShortcutDeps): void {
  const { autoCompress, handleCompress, suppressedClipboardTextRef } = deps;

  useEffect(() => {
    let active = true;
    let stopWatcher: (() => void) | undefined;

    async function setupClipboardWatch() {
      if (!autoCompress || !inTauriShell()) return;

      const [{ listen }, { invoke }] = await Promise.all([
        import('@tauri-apps/api/event'),
        import('@tauri-apps/api/core'),
      ]);

      await invoke('start_clipboard_watch');
      const unlisten = await listen<string>('clipboard-changed', (event) => {
        if (!active || !event.payload.trim()) return;
        if (event.payload === suppressedClipboardTextRef.current) {
          // Ignore the echo from our own clipboard write.
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
  }, [autoCompress, handleCompress, suppressedClipboardTextRef]);
}

/**
 * Handle `panel-opened` Tauri events (refire open animation) and the
 * Escape key (back out to main, then hide the window).
 */
export function useMenuBarShellListeners(deps: MenuBarShortcutDeps): void {
  const { panel, setPanel, triggerOpenAnimation } = deps;

  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;

    async function setupShellListeners() {
      if (!inTauriShell()) return;

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
          // First Escape returns to the main panel.
          setPanel('main');
          triggerOpenAnimation(true);
          return;
        }

        // Second Escape (already on main) hides the tray window.
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
  }, [panel, setPanel, triggerOpenAnimation]);
}
