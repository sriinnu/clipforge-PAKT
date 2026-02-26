/**
 * ClipForge content script.
 *
 * Injected into supported LLM sites (ChatGPT, Claude.ai, Gemini).
 * Adds a small floating pill-shaped compress button near text input areas.
 * The button appears on hover near the input and fades in/out smoothly.
 */

import { compress, detect } from '@sriinnu/pakt';
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
  'chatgpt.com': ['#prompt-textarea', 'textarea[data-id="root"]', 'div[contenteditable="true"]'],
  'claude.ai': ['div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"]'],
  'gemini.google.com': [
    '.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"]',
    'rich-textarea textarea',
  ],
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let compressBtn: HTMLButtonElement | null = null;
let activeInput: HTMLElement | null = null;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;
let isHoveringBtn = false;

// ---------------------------------------------------------------------------
// Button creation — small pill with compress icon
// ---------------------------------------------------------------------------

function createCompressButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11 3L3 11M3 11V5M3 11h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  btn.title = 'Compress with ClipForge';

  Object.assign(btn.style, {
    position: 'absolute',
    zIndex: '10000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    fontSize: '12px',
    fontWeight: '600',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    backgroundColor: '#7c3aed',
    color: '#fff',
    border: 'none',
    borderRadius: '14px',
    cursor: 'pointer',
    opacity: '0',
    transition: 'opacity 0.25s ease, background-color 0.2s ease, transform 0.2s ease',
    boxShadow: '0 2px 8px rgba(124, 58, 237, 0.4)',
    lineHeight: '1',
    pointerEvents: 'auto',
    padding: '0',
  });

  btn.addEventListener('mouseenter', () => {
    isHoveringBtn = true;
    btn.style.opacity = '1';
    btn.style.backgroundColor = '#6d28d9';
    btn.style.transform = 'scale(1.1)';
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  });

  btn.addEventListener('mouseleave', () => {
    isHoveringBtn = false;
    btn.style.backgroundColor = '#7c3aed';
    btn.style.transform = 'scale(1)';
    scheduleHide();
  });

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleCompress();
  });

  return btn;
}

// ---------------------------------------------------------------------------
// Show / hide with fade
// ---------------------------------------------------------------------------

function showButton(input: HTMLElement): void {
  if (!compressBtn) {
    compressBtn = createCompressButton();
    document.body.appendChild(compressBtn);
  }

  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }

  positionButton(input);
  compressBtn.style.opacity = '0.85';
  compressBtn.style.pointerEvents = 'auto';
}

function scheduleHide(): void {
  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    if (compressBtn && !isHoveringBtn) {
      compressBtn.style.opacity = '0';
      compressBtn.style.pointerEvents = 'none';
    }
  }, 800);
}

// ---------------------------------------------------------------------------
// Position the button near the active input (top-right corner, inside)
// ---------------------------------------------------------------------------

function positionButton(input: HTMLElement): void {
  if (!compressBtn) return;

  const rect = input.getBoundingClientRect();
  compressBtn.style.top = `${window.scrollY + rect.top + 6}px`;
  compressBtn.style.left = `${window.scrollX + rect.right - 36}px`;
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

      // Flash the button green briefly to confirm
      if (compressBtn) {
        compressBtn.style.backgroundColor = '#22c55e';
        compressBtn.style.boxShadow = '0 2px 8px rgba(34, 197, 94, 0.4)';
        compressBtn.innerHTML = `<span style="font-size:11px;font-weight:700">-${Math.round(result.savings.totalPercent)}%</span>`;
        setTimeout(() => {
          if (compressBtn) {
            compressBtn.style.backgroundColor = '#7c3aed';
            compressBtn.style.boxShadow = '0 2px 8px rgba(124, 58, 237, 0.4)';
            compressBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M11 3L3 11M3 11V5M3 11h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
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
    for (const el of found) {
      elements.push(el);
    }
  }
  return elements;
}

function attachToInput(input: HTMLElement): void {
  // Avoid attaching twice
  if (input.dataset.clipforgeAttached) return;
  input.dataset.clipforgeAttached = 'true';

  // Show button on hover near input
  input.addEventListener('mouseenter', () => {
    activeInput = input;
    showButton(input);
  });

  input.addEventListener('mouseleave', () => {
    scheduleHide();
  });

  // Also show on focus for keyboard users
  input.addEventListener('focus', () => {
    activeInput = input;
    showButton(input);
    // Auto-hide after a few seconds if not interacting with button
    scheduleHide();
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
