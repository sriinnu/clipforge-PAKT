/**
 * ClipForge background service worker (Chrome MV3).
 *
 * - Creates context menu items for quick compression
 * - Handles messages from popup and content scripts
 * - Updates badge text with token savings (green when savings > 0)
 * - Supports DECOMPRESS and AUTO message types for bidirectional flow
 */

import {
  compress,
  compressMixed,
  countTokens,
  decompress,
  decompressMixed,
  detect,
} from '@sriinnu/pakt';
import { getSettings } from '../shared/storage';

// ---------------------------------------------------------------------------
// Context menus
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'clipforge-compress',
    title: 'Compress with ClipForge',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: 'clipforge-copy-pakt',
    title: 'Copy as PAKT',
    contexts: ['selection'],
  });

  // Clear badge on install
  chrome.action.setBadgeText({ text: '' });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(info, tab).catch((err) => {
    console.error('[ClipForge] Context menu handler failed:', err);
  });
});

/**
 * Compresses the selected text according to its detected format.
 *
 * Routes text/markdown through `compressMixed`; structured formats (json/yaml/csv)
 * through `compress`.
 *
 * @param text - The selected text to compress.
 * @param settings - Extension settings for layer configuration.
 * @returns Object with compressed text and savings percentage.
 */
async function compressSelection(
  text: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
): Promise<{ compressedText: string; savingsPercent: number }> {
  const result = compressForDetectedFormat(text, settings);
  return {
    compressedText: result.compressed,
    savingsPercent: result.savings.totalPercent,
  };
}

function compressForDetectedFormat(
  text: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
) {
  const format = detect(text).format;
  const layerOpts = {
    structural: settings.layerStructural,
    dictionary: settings.layerDictionary,
    tokenizerAware: false,
    semantic: false,
  };

  if (format === 'markdown' || format === 'text') {
    const result = compressMixed(text, { layers: layerOpts });
    return {
      compressed: result.compressed,
      originalTokens: result.originalTokens,
      compressedTokens: result.compressedTokens,
      savings: result.savings,
      reversible: result.reversible,
      detectedFormat: format,
      dictionary: [],
    };
  }

  return compress(text, { layers: layerOpts });
}

/**
 * Handles a context-menu click event: compresses the selection and either
 * copies it to clipboard or pushes it to the active input.
 *
 * @param info - Chrome context menu event info.
 * @param tab - The tab in which the selection was made.
 */
async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  const selectedText = info.selectionText;
  if (!selectedText) return;

  const settings = await getSettings();
  const { compressedText, savingsPercent } = await compressSelection(selectedText, settings);

  if (info.menuItemId === 'clipforge-copy-pakt' && tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'COPY_TO_CLIPBOARD', text: compressedText });
    } catch {
      // Content script might not be loaded — ignore
    }
    updateBadge(savingsPercent, tab.id);
  }

  if (info.menuItemId === 'clipforge-compress' && tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_COMPRESSED',
        compressed: compressedText,
        savings: savingsPercent,
      });
    } catch {
      // Content script might not be loaded — ignore
    }
    updateBadge(savingsPercent, tab.id);
  }
}

// ---------------------------------------------------------------------------
// Message interfaces
// ---------------------------------------------------------------------------

/** Message requesting PAKT compression of text. */
export interface CompressMessage {
  type: 'COMPRESS';
  text: string;
}

/** Message requesting format detection of text. */
export interface DetectMessage {
  type: 'DETECT';
  text: string;
}

/** Message requesting token count for text. */
export interface CountTokensMessage {
  type: 'COUNT_TOKENS';
  text: string;
}

/**
 * Message requesting decompression of PAKT text.
 * Tries `decompressMixed` first (for mixed content with PAKT markers),
 * falls back to `decompress` for pure PAKT documents.
 */
export interface DecompressMessage {
  type: 'DECOMPRESS';
  text: string;
}

/**
 * Message requesting automatic compress-or-decompress routing.
 * Detects the format: if PAKT → decompresses; otherwise → compresses
 * (using compressMixed for text/markdown, compress for structured formats).
 */
export interface AutoMessage {
  type: 'AUTO';
  text: string;
}

type ExtensionMessage =
  | CompressMessage
  | DetectMessage
  | CountTokensMessage
  | DecompressMessage
  | AutoMessage;

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: String(err) }));

    // Return true to indicate async response
    return true;
  },
);

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

/**
 * Routes incoming extension messages to the appropriate handler.
 *
 * @param message - The typed extension message.
 * @returns A promise resolving to the handler result.
 */
async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  const settings = await getSettings();

  switch (message.type) {
    case 'COMPRESS': {
      const result = compressForDetectedFormat(message.text, settings);
      updateBadge(result.savings.totalPercent);
      return result;
    }

    case 'DETECT': {
      return detect(message.text);
    }

    case 'COUNT_TOKENS': {
      return { tokens: countTokens(message.text) };
    }

    case 'DECOMPRESS': {
      return handleDecompress(message.text);
    }

    case 'AUTO': {
      return handleAuto(message.text, settings);
    }

    default:
      return { error: 'Unknown message type' };
  }
}

// ---------------------------------------------------------------------------
// Decompress helper
// ---------------------------------------------------------------------------

/**
 * Decompresses PAKT-encoded text.
 *
 * Tries `decompressMixed` first to handle documents with embedded PAKT markers.
 * If no markers were found (output equals input), falls back to `decompress`
 * for pure PAKT documents.
 *
 * @param text - The PAKT-encoded or mixed text to decompress.
 * @returns An object with the restored `text` string.
 */
function handleDecompress(text: string): { text: string } {
  // Try mixed decompression first (handles <!-- PAKT:format --> markers)
  const mixedResult = decompressMixed(text);

  if (mixedResult !== text) {
    return { text: mixedResult };
  }

  // Fallback: plain decompress for pure PAKT documents
  try {
    const result = decompress(text);
    return { text: result.text };
  } catch {
    // If decompress also fails, return original
    return { text };
  }
}

// ---------------------------------------------------------------------------
// Auto (compress-or-decompress) helper
// ---------------------------------------------------------------------------

/**
 * Automatically determines whether to compress or decompress the input.
 *
 * - If the detected format is `'pakt'`, decompresses via `handleDecompress`.
 * - If the format is `'text'` or `'markdown'`, compresses via `compressMixed`.
 * - Otherwise compresses via `compress` (for json/yaml/csv).
 *
 * @param text - The input text to process.
 * @param settings - Current extension settings for layer configuration.
 * @returns The processed result object.
 */
async function handleAuto(
  text: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
): Promise<unknown> {
  const detection = detect(text);
  if (detection.format === 'pakt') {
    return handleDecompress(text);
  }

  const result = compressForDetectedFormat(text, settings);
  updateBadge(result.savings.totalPercent);
  return result;
}

// ---------------------------------------------------------------------------
// Badge — shows savings percentage with green bg when > 0
// ---------------------------------------------------------------------------

/**
 * Updates the extension badge with a savings percentage.
 *
 * Shows a green badge when savings > 0, clears it otherwise.
 *
 * @param savingsPercent - Token savings percentage (0–100).
 * @param tabId - Optional tab ID to scope the badge to a specific tab.
 */
function updateBadge(savingsPercent: number, tabId?: number): void {
  const rounded = Math.round(savingsPercent);

  if (rounded > 0) {
    const text = `${rounded}%`;
    const opts: chrome.action.BadgeTextDetails = { text };
    if (tabId !== undefined) opts.tabId = tabId;
    chrome.action.setBadgeText(opts);

    const colorOpts: chrome.action.BadgeColorDetails = { color: '#22c55e' };
    if (tabId !== undefined) colorOpts.tabId = tabId;
    chrome.action.setBadgeBackgroundColor(colorOpts);
  } else {
    const opts: chrome.action.BadgeTextDetails = { text: '' };
    if (tabId !== undefined) opts.tabId = tabId;
    chrome.action.setBadgeText(opts);
  }
}
