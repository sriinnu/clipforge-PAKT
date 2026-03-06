/**
 * ClipForge content script.
 *
 * Injected into supported LLM sites (ChatGPT, Claude.ai, Gemini).
 * Adds a floating pill-shaped button near text input areas.
 *
 * Button behaviour is bidirectional:
 *  - Raw text / markdown → compress via compressMixed
 *  - PAKT-compressed text → decompress via decompressMixed (with compress fallback)
 *
 * Button DOM management lives in `button.ts`.
 */

import { compress, compressMixed, decompress, decompressMixed, detect } from '@sriinnu/pakt';
import { getSettings } from '../shared/storage';
import {
  flashSuccess,
  getActiveInput,
  resetToCompressMode,
  scheduleHide,
  setActiveInput,
  setButtonClickHandler,
  showButton,
} from './button';

// ---------------------------------------------------------------------------
// Site-specific input selectors
// ---------------------------------------------------------------------------

const SITE_SELECTORS: Record<string, string[]> = {
  'chat.openai.com': [
    '#prompt-textarea',
    'textarea[data-id="root"]',
    'div[contenteditable="true"]',
  ],
  'chatgpt.com': ['#prompt-textarea', 'textarea[data-id="root"]', 'div[contenteditable="true"]'],
  'claude.ai': ['div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"]'],
  'gemini.google.com': [
    '.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"]',
    'rich-textarea textarea',
  ],
};

// ---------------------------------------------------------------------------
// Wire the button click to our handler
// ---------------------------------------------------------------------------

setButtonClickHandler(handleCompressOrDecompress);

// ---------------------------------------------------------------------------
// Get / set text content of input elements
// ---------------------------------------------------------------------------

/**
 * Reads the current text content of a form input or contenteditable element.
 *
 * @param el - The element to read from.
 * @returns The current text value.
 */
function getInputText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.value;
  }
  return el.textContent ?? '';
}

/**
 * Writes text into a form input or contenteditable element and dispatches
 * an `input` event so the host app reacts to the change.
 *
 * @param el - The target element.
 * @param text - The text to write.
 */
function setInputText(el: HTMLElement, text: string): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    valueSetter?.call(el, text);
    el.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
    );
    return;
  }

  replaceContentEditableText(el, text);
}

function replaceContentEditableText(el: HTMLElement, text: string): void {
  el.focus();

  const selection = window.getSelection();
  if (!selection) {
    el.textContent = text;
    el.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
    );
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);

  el.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    }),
  );

  try {
    if (
      typeof document.execCommand === 'function' &&
      document.execCommand('insertText', false, text)
    ) {
      el.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
      );
      return;
    }
  } catch {
    // Fall through to manual DOM replacement.
  }

  range.deleteContents();
  range.insertNode(buildContentFragment(text));
  selection.removeAllRanges();
  const endRange = document.createRange();
  endRange.selectNodeContents(el);
  endRange.collapse(false);
  selection.addRange(endRange);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}

function buildContentFragment(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    if (index > 0) {
      fragment.append(document.createElement('br'));
    }
    fragment.append(document.createTextNode(line));
  });

  return fragment;
}

// ---------------------------------------------------------------------------
// Compress / Decompress handler
// ---------------------------------------------------------------------------

/**
 * Dispatches to either compression or decompression based on the detected
 * format of the current active input.
 *
 * - `'pakt'`     → decompresses via `handleDecompressInput`
 * - `'markdown'` / `'text'` → compresses via `compressMixed`
 * - Other formats → compresses via `compress` (json/yaml/csv path)
 */
async function handleCompressOrDecompress(): Promise<void> {
  const activeInput = getActiveInput();
  if (!activeInput) return;

  const text = getInputText(activeInput);
  if (!text.trim()) return;

  const settings = await getSettings();

  try {
    const detection = detect(text);

    // --- Decompress path ---
    if (detection.format === 'pakt') {
      await handleDecompressInput(activeInput, text);
      return;
    }

    const format = detection.format;

    // Skip very low-confidence plain text
    if (format === 'text' && detection.confidence < 0.5) return;

    let compressed: string;
    let savingsPercent: number;

    if (format === 'markdown' || format === 'text') {
      // Mixed-content path: finds and compresses embedded JSON/YAML/CSV blocks
      const result = compressMixed(text, {
        layers: {
          structural: settings.layerStructural,
          dictionary: settings.layerDictionary,
          tokenizerAware: false,
          semantic: false,
        },
      });
      compressed = result.compressed;
      savingsPercent = result.savings.totalPercent;
    } else {
      // Structured format path (json/yaml/csv)
      const result = compress(text, {
        layers: {
          structural: settings.layerStructural,
          dictionary: settings.layerDictionary,
          tokenizerAware: false,
          semantic: false,
        },
      });
      compressed = result.compressed;
      savingsPercent = result.savings.totalPercent;
    }

    // Only replace if we actually saved tokens
    if (savingsPercent > 5) {
      setInputText(activeInput, compressed);
      flashSuccess(savingsPercent);
    }
  } catch (err) {
    console.error('[ClipForge] Content script compress/decompress failed:', err);
  }
}

/**
 * Decompresses PAKT text from an input element and writes the result back.
 *
 * Tries `decompressMixed` first (handles embedded `<!-- PAKT:format -->` markers
 * in mixed content); falls back to plain `decompress` for pure PAKT documents.
 *
 * @param el - The input element whose content should be decompressed.
 * @param text - The current text of the element (passed to avoid re-reading).
 */
async function handleDecompressInput(el: HTMLElement, text: string): Promise<void> {
  try {
    const mixedResult = decompressMixed(text);

    if (mixedResult !== text) {
      // Mixed markers were resolved — write result back
      setInputText(el, mixedResult);
    } else {
      // Fallback: plain decompress for pure PAKT documents
      const result = decompress(text);
      setInputText(el, result.text);
    }

    // Reset button icon to compress mode
    resetToCompressMode();
  } catch (err) {
    console.error('[ClipForge] Content script decompression failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Attach to input elements
// ---------------------------------------------------------------------------

/**
 * Returns all matching input elements on the current page using site-specific
 * selectors.
 *
 * @returns Array of matching HTMLElements.
 */
function findInputs(): HTMLElement[] {
  const hostname = window.location.hostname;
  const selectors = SITE_SELECTORS[hostname];
  if (!selectors) return [];

  const elements: HTMLElement[] = [];
  for (const selector of selectors) {
    const found = document.querySelectorAll<HTMLElement>(selector);
    for (const el of found) {
      elements.push(el);
    }
  }
  return elements;
}

/**
 * Attaches ClipForge hover/focus listeners to an input element.
 * Safe to call multiple times — uses a data attribute guard.
 *
 * @param input - The input element to attach to.
 */
function attachToInput(input: HTMLElement): void {
  if (input.dataset.clipforgeAttached) return;
  input.dataset.clipforgeAttached = 'true';

  input.addEventListener('mouseenter', () => {
    setActiveInput(input);
    showButton(input);
  });

  input.addEventListener('mouseleave', () => {
    scheduleHide();
  });

  input.addEventListener('focus', () => {
    setActiveInput(input);
    showButton(input);
    scheduleHide();
  });
}

/** Scans the page for new inputs and attaches ClipForge to them. */
function scanAndAttach(): void {
  const inputs = findInputs();
  for (const input of inputs) {
    attachToInput(input);
  }
}

// ---------------------------------------------------------------------------
// Message handling from background script
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: { type: string; text?: string; compressed?: string },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    if (message.type === 'COPY_TO_CLIPBOARD' && message.text) {
      navigator.clipboard
        .writeText(message.text)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ error: String(err) }));
      return true;
    }

    if (message.type === 'SHOW_COMPRESSED' && message.compressed) {
      const activeInput = getActiveInput();
      if (activeInput) {
        setInputText(activeInput, message.compressed);
      }
      sendResponse({ success: true });
    }

    return false;
  },
);

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

// Initial scan
scanAndAttach();

// Watch for dynamically added inputs (SPA navigation)
const observer = new MutationObserver(() => {
  scanAndAttach();
});
observer.observe(document.body, { childList: true, subtree: true });

// Re-scan on SPA navigation
let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    scanAndAttach();
  }
});
urlObserver.observe(document, { subtree: true, childList: true });
