/**
 * ClipForge content script.
 *
 * Injected into supported LLM sites (ChatGPT, Claude.ai, Gemini).
 * Adds a floating pill-shaped button near text input areas.
 */

import {
  compress,
  compressMixed,
  createProfiledPaktOptions,
  decompress,
  decompressMixed,
  detect,
} from '@sriinnu/pakt';
import { getSupportedSite } from '../shared/site-support';
import { type ExtensionSettings, getSettings, onSettingsChange } from '../shared/storage';
import {
  flashSuccess,
  getActiveInput,
  resetToCompressMode,
  scheduleHide,
  setActiveInput,
  setButtonClickHandler,
  showButton,
} from './button';

setButtonClickHandler(handleCompressOrDecompress);

// Cached settings snapshot — the paste handler runs synchronously and cannot
// `await getSettings()` without losing the chance to call preventDefault().
let cachedSettings: ExtensionSettings | null = null;
void getSettings().then((s) => {
  cachedSettings = s;
});
onSettingsChange((partial) => {
  if (cachedSettings) cachedSettings = { ...cachedSettings, ...partial };
});

/**
 * Decide whether the content script should act on the current hostname.
 *
 * Returns false when the user has narrowed the manifest matches via
 * `settings.siteWhitelist`. An empty whitelist means “all manifest matches”.
 */
function isHostAllowed(): boolean {
  const whitelist = cachedSettings?.siteWhitelist ?? [];
  if (whitelist.length === 0) return true;
  const host = window.location.hostname.toLowerCase();
  return whitelist.some((entry) => entry.toLowerCase() === host);
}

function getInputText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.value;
  }
  return el.textContent ?? '';
}

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

async function handleCompressOrDecompress(): Promise<void> {
  const activeInput = getActiveInput();
  if (!activeInput) return;

  const text = getInputText(activeInput);
  if (!text.trim()) return;

  const settings = await getSettings();

  try {
    const detection = detect(text);

    if (detection.format === 'pakt') {
      await handleDecompressInput(activeInput, text);
      return;
    }

    const format = detection.format;
    const options = createProfiledPaktOptions(settings.compressionProfileId, {
      ...(settings.compressionProfileId === 'semantic'
        ? { semanticBudget: settings.semanticBudget }
        : {}),
      ...(settings.piiMode !== 'off' ? { piiMode: settings.piiMode } : {}),
      targetModel: settings.targetModel,
    });

    let compressed: string;
    let savingsPercent: number;

    if (format === 'markdown' || format === 'text') {
      const result = compressMixed(text, options);
      compressed = result.compressed;
      savingsPercent = result.savings.totalPercent;
    } else {
      const result = compress(text, options);
      compressed = result.compressed;
      savingsPercent = result.savings.totalPercent;
    }

    if (savingsPercent > 0) {
      setInputText(activeInput, compressed);
      flashSuccess(savingsPercent);
    }
  } catch (err) {
    console.error('[ClipForge] Content script compress/decompress failed:', err);
  }
}

async function handleDecompressInput(el: HTMLElement, text: string): Promise<void> {
  try {
    const mixedResult = decompressMixed(text);

    if (mixedResult !== text) {
      setInputText(el, mixedResult);
    } else {
      const result = decompress(text);
      setInputText(el, result.text);
    }

    resetToCompressMode();
  } catch (err) {
    console.error('[ClipForge] Content script decompression failed:', err);
  }
}

function findInputs(): HTMLElement[] {
  if (!isHostAllowed()) return [];
  const supportedSite = getSupportedSite(window.location.hostname);
  const selectors = supportedSite?.selectors;
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

  // Paste interception. Always attached — the handler itself bails out when
  // the user has not enabled `autoCompressOnPaste`, which lets users flip
  // the toggle without reloading the page.
  input.addEventListener('paste', (event) => {
    void handlePasteIntercept(input, event);
  });
}

/**
 * Replace pasted plain text with its PAKT-compressed form.
 *
 * Bails out (and lets the browser do its normal paste) when:
 *   - the user has not enabled auto-compress on paste,
 *   - the current hostname is not in the user’s allowlist,
 *   - the clipboard payload is empty / non-text / already PAKT,
 *   - or the compressor would not save any tokens.
 */
async function handlePasteIntercept(input: HTMLElement, event: ClipboardEvent): Promise<void> {
  const settings = cachedSettings ?? (await getSettings());
  cachedSettings = settings;
  if (!settings.autoCompressOnPaste) return;
  if (!isHostAllowed()) return;

  const clipboard = event.clipboardData;
  if (!clipboard) return;
  const text = clipboard.getData('text/plain');
  if (!text || !text.trim()) return;

  // Already compressed — let it paste through untouched.
  try {
    if (detect(text).format === 'pakt') return;
  } catch {
    return;
  }

  try {
    const options = createProfiledPaktOptions(settings.compressionProfileId, {
      ...(settings.compressionProfileId === 'semantic'
        ? { semanticBudget: settings.semanticBudget }
        : {}),
      ...(settings.piiMode !== 'off' ? { piiMode: settings.piiMode } : {}),
      targetModel: settings.targetModel,
    });
    const detection = detect(text);
    const result =
      detection.format === 'markdown' || detection.format === 'text'
        ? compressMixed(text, options)
        : compress(text, options);

    if (result.savings.totalPercent <= 0) return;

    event.preventDefault();
    setActiveInput(input);
    setInputText(input, result.compressed);
    flashSuccess(result.savings.totalPercent);
  } catch (err) {
    console.error('[ClipForge] Paste interception failed:', err);
  }
}

function scanAndAttach(): void {
  const inputs = findInputs();
  for (const input of inputs) {
    attachToInput(input);
  }
}

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

scanAndAttach();

const observer = new MutationObserver(() => {
  scanAndAttach();
});
observer.observe(document.body, { childList: true, subtree: true });

let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    scanAndAttach();
  }
});
urlObserver.observe(document, { subtree: true, childList: true });
