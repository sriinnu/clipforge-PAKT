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

export interface ClipboardState {
  content: string;
  readClipboard: () => Promise<void>;
  writeClipboard: (text: string) => Promise<void>;
}

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
