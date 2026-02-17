/**
 * ClipForge background service worker (Chrome MV3).
 *
 * - Creates context menu items for quick compression
 * - Handles messages from popup and content scripts
 * - Updates badge text with token savings (green when savings > 0)
 */

import { compress, detect, countTokens } from '@yugenlab/pakt';
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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const selectedText = info.selectionText;
  if (!selectedText) return;

  const settings = await getSettings();

  try {
    const result = compress(selectedText, {
      layers: {
        structural: settings.layerStructural,
        dictionary: settings.layerDictionary,
        tokenizerAware: false,
        semantic: false,
      },
    });

    if (info.menuItemId === 'clipforge-copy-pakt') {
      // Write compressed text to clipboard via content script
      if (tab?.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'COPY_TO_CLIPBOARD',
            text: result.compressed,
          });
        } catch {
          // Content script might not be loaded — ignore
        }
      }
      updateBadge(result.savings.totalPercent, tab?.id);
    }

    if (info.menuItemId === 'clipforge-compress') {
      // Send compressed result back to content script
      if (tab?.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'SHOW_COMPRESSED',
            compressed: result.compressed,
            savings: result.savings.totalPercent,
            originalTokens: result.originalTokens,
            compressedTokens: result.compressedTokens,
          });
        } catch {
          // Content script might not be loaded — ignore
        }
      }
      updateBadge(result.savings.totalPercent, tab?.id);
    }
  } catch (err) {
    console.error('[ClipForge] Compression failed:', err);
  }
});

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

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

type ExtensionMessage = CompressMessage | DetectMessage | CountTokensMessage;

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

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  const settings = await getSettings();

  switch (message.type) {
    case 'COMPRESS': {
      const result = compress(message.text, {
        layers: {
          structural: settings.layerStructural,
          dictionary: settings.layerDictionary,
          tokenizerAware: false,
          semantic: false,
        },
      });
      updateBadge(result.savings.totalPercent);
      return result;
    }

    case 'DETECT': {
      return detect(message.text);
    }

    case 'COUNT_TOKENS': {
      return { tokens: countTokens(message.text) };
    }

    default:
      return { error: 'Unknown message type' };
  }
}

// ---------------------------------------------------------------------------
// Badge — shows savings percentage with green bg when > 0
// ---------------------------------------------------------------------------

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
