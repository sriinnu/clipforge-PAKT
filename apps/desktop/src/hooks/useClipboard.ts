/**
 * @module useClipboard
 * Platform-agnostic clipboard access for the desktop app.
 *
 * Attempts to use the Tauri clipboard plugin at runtime. When running
 * in a browser dev environment (no Tauri), falls back to the Web
 * Clipboard API (`navigator.clipboard`).
 *
 * Wired to useCompactor via MenuBarPanel: clipboard read feeds input,
 * compressed output writes back to clipboard.
 */

import { useCallback, useState } from 'react';

/**
 * Try to import the Tauri clipboard plugin at runtime.
 * Falls back to navigator.clipboard for browser dev mode.
 */
async function getTauriClipboard() {
  try {
    const mod = await import('@tauri-apps/plugin-clipboard-manager');
    return mod;
  } catch {
    return null;
  }
}

/** State shape returned by {@link useClipboard}. */
export interface ClipboardState {
  /** Last-read clipboard text content. */
  content: string;
  /** Read text from the system clipboard into `content`. */
  readClipboard: () => Promise<void>;
  /** Write text to the system clipboard. */
  writeClipboard: (text: string) => Promise<void>;
}

/**
 * Hook providing read/write access to the system clipboard.
 * Prefers Tauri native clipboard; falls back to Web Clipboard API.
 */
export function useClipboard(): ClipboardState {
  const [content, setContent] = useState('');

  const readClipboard = useCallback(async () => {
    try {
      const tauri = await getTauriClipboard();
      if (tauri) {
        const text = await tauri.readText();
        setContent(text ?? '');
      } else {
        const text = await navigator.clipboard.readText();
        setContent(text);
      }
    } catch {
      // Clipboard access denied or unavailable
    }
  }, []);

  const writeClipboard = useCallback(async (text: string) => {
    try {
      const tauri = await getTauriClipboard();
      if (tauri) {
        await tauri.writeText(text);
      } else {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // Clipboard write failed
    }
  }, []);

  return { content, readClipboard, writeClipboard };
}
