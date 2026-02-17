/**
 * ClipForge content script.
 *
 * Injected into supported LLM sites (ChatGPT, Claude.ai, Gemini).
 * Adds a floating "Compress" button near text input areas.
 */

import { compress, detect } from '@yugenlab/pakt';
import { getSettings } from '../shared/storage';

// ---------------------------------------------------------------------------
// Site-specific input selectors
// ---------------------------------------------------------------------------

const SITE_SELECTORS: Record<string, string[]> = {
  'chat.openai.com': [
    '#prompt-textarea',
    'textarea[data-id="root"]',
    'div[contenteditable="true"]',
  ],
  'chatgpt.com': [
    '#prompt-textarea',
    'textarea[data-id="root"]',
    'div[contenteditable="true"]',
  ],
  'claude.ai': [
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"]',
  ],
  'gemini.google.com': [
    '.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"]',
    'rich-textarea textarea',
  ],
};

// ---------------------------------------------------------------------------
// Brand colors
// ---------------------------------------------------------------------------

const PRIMARY = '#7c3aed';
const PRIMARY_HOVER = '#6d28d9';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let compressBtn: HTMLButtonElement | null = null;
let activeInput: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// Button creation
// ---------------------------------------------------------------------------

function createCompressButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = 'PAKT';
  btn.title = 'Compress with ClipForge';

  Object.assign(btn.style, {
    position: 'absolute',
    zIndex: '10000',
    padding: '4px 8px',
    fontSize: '11px',
    fontWeight: '700',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    backgroundColor: PRIMARY,
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    opacity: '0.85',
    transition: 'opacity 0.2s, background-color 0.2s',
    boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    lineHeight: '1',
  });

  btn.addEventListener('mouseenter', () => {
    btn.style.opacity = '1';
    btn.style.backgroundColor = PRIMARY_HOVER;
  });

  btn.addEventListener('mouseleave', () => {
    btn.style.opacity = '0.85';
    btn.style.backgroundColor = PRIMARY;
  });

  btn.addEventListener('click', handleCompress);

  return btn;
}

// ---------------------------------------------------------------------------
// Position the button near the active input
// ---------------------------------------------------------------------------

function positionButton(input: HTMLElement): void {
  if (!compressBtn) return;

  const rect = input.getBoundingClientRect();
  compressBtn.style.top = `${window.scrollY + rect.top + 4}px`;
  compressBtn.style.left = `${window.scrollX + rect.right - 60}px`;
}

// ---------------------------------------------------------------------------
// Get / set text content of input elements
// ---------------------------------------------------------------------------

function getInputText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.value;
  }
  return el.textContent ?? '';
}

function setInputText(el: HTMLElement, text: string): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // contenteditable elements
  el.textContent = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Compress handler
// ---------------------------------------------------------------------------

async function handleCompress(): Promise<void> {
  if (!activeInput) return;

  const text = getInputText(activeInput);
  if (!text.trim()) return;

  const settings = await getSettings();

  try {
    const detection = detect(text);

    // Don't compress already-compressed PAKT content
    if (detection.format === 'pakt') return;

    // Only compress structured formats that benefit from PAKT
    if (detection.format === 'text' && detection.confidence < 0.5) return;

    const result = compress(text, {
      layers: {
        structural: settings.layerStructural,
        dictionary: settings.layerDictionary,
        tokenizerAware: false,
        semantic: false,
      },
    });

    // Only replace if we actually saved tokens
    if (result.savings.totalPercent > 5) {
      setInputText(activeInput, result.compressed);

      // Briefly show savings on the button
      if (compressBtn) {
        const original = compressBtn.textContent;
        compressBtn.textContent = `-${Math.round(result.savings.totalPercent)}%`;
        compressBtn.style.backgroundColor = '#22c55e';
        setTimeout(() => {
          if (compressBtn) {
            compressBtn.textContent = original;
            compressBtn.style.backgroundColor = PRIMARY;
          }
        }, 2000);
      }
    }
  } catch (err) {
    console.error('[ClipForge] Content script compression failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Observe for input areas
// ---------------------------------------------------------------------------

function findInputs(): HTMLElement[] {
  const hostname = window.location.hostname;
  const selectors = SITE_SELECTORS[hostname];
  if (!selectors) return [];

  const elements: HTMLElement[] = [];
  for (const selector of selectors) {
    const found = document.querySelectorAll<HTMLElement>(selector);
    found.forEach((el) => elements.push(el));
  }
  return elements;
}

function attachToInput(input: HTMLElement): void {
  // Avoid attaching twice
  if (input.dataset['clipforgeAttached']) return;
  input.dataset['clipforgeAttached'] = 'true';

  input.addEventListener('focus', () => {
    activeInput = input;
    if (!compressBtn) {
      compressBtn = createCompressButton();
      document.body.appendChild(compressBtn);
    }
    positionButton(input);
    compressBtn.style.display = 'block';
  });

  input.addEventListener('blur', () => {
    // Delay hide so the button click can register
    setTimeout(() => {
      if (compressBtn && document.activeElement !== compressBtn) {
        compressBtn.style.display = 'none';
      }
    }, 200);
  });
}

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
      // If there's an active input, replace its content
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

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// Re-scan on SPA navigation
let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    scanAndAttach();
  }
});
urlObserver.observe(document, { subtree: true, childList: true });
