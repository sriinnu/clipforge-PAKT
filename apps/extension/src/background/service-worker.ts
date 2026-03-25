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
  createProfiledPaktOptions,
  decompress,
  decompressMixed,
  detect,
} from '@sriinnu/pakt';
import { getSettings } from '../shared/storage';

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

  chrome.action.setBadgeText({ text: '' });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(info, tab).catch((err) => {
    console.error('[ClipForge] Context menu handler failed:', err);
  });
});

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
  const options = createProfiledPaktOptions(settings.compressionProfileId, {
    ...(settings.compressionProfileId === 'semantic'
      ? { semanticBudget: settings.semanticBudget }
      : {}),
  });

  if (format === 'markdown' || format === 'text') {
    const result = compressMixed(text, options);
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

  return compress(text, options);
}

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

export interface CompressMessage {
  type: 'COMPRESS';
  text: string;
}

export interface DetectMessage {
  type: 'DETECT';
  text: string;
}

export interface CountTokensMessage {
  type: 'COUNT_TOKENS';
  text: string;
}

export interface DecompressMessage {
  type: 'DECOMPRESS';
  text: string;
}

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

    return true;
  },
);

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

function handleDecompress(text: string): { text: string } {
  const mixedResult = decompressMixed(text);

  if (mixedResult !== text) {
    return { text: mixedResult };
  }

  try {
    const result = decompress(text);
    return { text: result.text };
  } catch {
    return { text };
  }
}

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
