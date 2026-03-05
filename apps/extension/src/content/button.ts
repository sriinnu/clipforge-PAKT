/**
 * @module content/button
 * Manages the floating compress/decompress pill button injected by the
 * ClipForge content script.
 *
 * Handles creation, positioning, show/hide with fade, icon toggling between
 * compress (↑) and decompress (↓) modes, and the green success flash.
 */

import { detect } from '@sriinnu/pakt';

// ---------------------------------------------------------------------------
// SVG icons
// ---------------------------------------------------------------------------

/** Compress icon — arrow pointing inward/downward. */
export const COMPRESS_ICON = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M11 3L3 11M3 11V5M3 11h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/** Decompress icon — arrow pointing outward/upward. */
export const DECOMPRESS_ICON = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 11L11 3M11 3V9M11 3H5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** The singleton floating button element, or null if not yet created. */
let compressBtn: HTMLButtonElement | null = null;

/** The input element the button is currently associated with. */
let activeInput: HTMLElement | null = null;

/** Timer handle used to fade the button after a delay. */
let hideTimeout: ReturnType<typeof setTimeout> | null = null;

/** Whether the mouse cursor is currently over the button. */
let isHoveringBtn = false;

/** Callback invoked when the button is clicked. Set by the content script. */
let onClickCallback: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Registers the click handler that should run when the button is pressed.
 *
 * @param handler - The async compress-or-decompress function.
 */
export function setButtonClickHandler(handler: () => void): void {
  onClickCallback = handler;
}

/**
 * Returns the current active input element, or null.
 */
export function getActiveInput(): HTMLElement | null {
  return activeInput;
}

/**
 * Sets the active input element (called from hover/focus listeners).
 *
 * @param input - The newly active input.
 */
export function setActiveInput(input: HTMLElement): void {
  activeInput = input;
}

/**
 * Creates the floating compress/decompress pill button and appends it to
 * `document.body`. Safe to call multiple times — returns existing instance.
 *
 * @returns The singleton button element.
 */
export function getOrCreateButton(): HTMLButtonElement {
  if (compressBtn) return compressBtn;

  const btn = document.createElement('button');
  btn.innerHTML = COMPRESS_ICON;
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
    // Re-check PAKT state on hover so icon is always current
    updateButtonMode();
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
    if (onClickCallback) onClickCallback();
  });

  document.body.appendChild(btn);
  compressBtn = btn;
  return btn;
}

/**
 * Shows the floating button near the given input element.
 *
 * @param input - The target input element to position the button near.
 */
export function showButton(input: HTMLElement): void {
  const btn = getOrCreateButton();

  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }

  positionButton(input, btn);
  updateButtonMode();
  btn.style.opacity = '0.85';
  btn.style.pointerEvents = 'auto';
}

/**
 * Schedules the button to fade out after 800 ms unless the user is hovering.
 */
export function scheduleHide(): void {
  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    if (compressBtn && !isHoveringBtn) {
      compressBtn.style.opacity = '0';
      compressBtn.style.pointerEvents = 'none';
    }
  }, 800);
}

/**
 * Reads the current text from the active input and updates the button's icon
 * and title to reflect whether the content is PAKT or raw text.
 */
export function updateButtonMode(): void {
  if (!compressBtn || !activeInput) return;

  const text =
    activeInput instanceof HTMLTextAreaElement || activeInput instanceof HTMLInputElement
      ? activeInput.value
      : (activeInput.textContent ?? '');

  let isPakt = false;
  try {
    isPakt = detect(text).format === 'pakt';
  } catch {
    isPakt = false;
  }

  if (isPakt) {
    compressBtn.innerHTML = DECOMPRESS_ICON;
    compressBtn.title = 'Decompress with ClipForge';
  } else {
    compressBtn.innerHTML = COMPRESS_ICON;
    compressBtn.title = 'Compress with ClipForge';
  }
}

/**
 * Briefly changes the button to a success (green) state showing token savings,
 * then restores the idle compress icon after 2 seconds.
 *
 * @param savingsPercent - Token savings percentage to display.
 */
export function flashSuccess(savingsPercent: number): void {
  if (!compressBtn) return;

  compressBtn.style.backgroundColor = '#22c55e';
  compressBtn.style.boxShadow = '0 2px 8px rgba(34, 197, 94, 0.4)';
  compressBtn.innerHTML = `<span style="font-size:11px;font-weight:700">-${Math.round(savingsPercent)}%</span>`;

  setTimeout(() => {
    if (!compressBtn) return;
    compressBtn.style.backgroundColor = '#7c3aed';
    compressBtn.style.boxShadow = '0 2px 8px rgba(124, 58, 237, 0.4)';
    updateButtonMode();
  }, 2000);
}

/**
 * Resets the button to the compress icon and title (used after decompression).
 */
export function resetToCompressMode(): void {
  if (!compressBtn) return;
  compressBtn.innerHTML = COMPRESS_ICON;
  compressBtn.title = 'Compress with ClipForge';
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Repositions the button to the top-right corner of the given input element.
 *
 * @param input - The element to align to.
 * @param btn - The button element to reposition.
 */
function positionButton(input: HTMLElement, btn: HTMLButtonElement): void {
  const rect = input.getBoundingClientRect();
  btn.style.top = `${window.scrollY + rect.top + 6}px`;
  btn.style.left = `${window.scrollX + rect.right - 36}px`;
}
