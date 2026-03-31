/**
 * Custom hook to manage theme + font application.
 *
 * Reads the `theme` and `fontPreset` settings from chrome.storage.sync,
 * applies the correct CSS class / CSS custom properties to the `<html>`
 * element, and listens for storage changes so updates are live.
 */

import { useEffect, useRef } from 'react';
import { getSettings, onSettingsChange } from '../shared/storage';
import { FONT_PRESETS, type FontPreset, loadBundledFonts } from './fonts';
import { CSS_VARS } from './styles';

/**
 * Map the stored theme value to a CSS class on <html>.
 * - 'dark'   -> no extra class (dark is the :root default)
 * - 'light'  -> class="theme-light"
 * - 'oled'   -> class="theme-oled" (true black for OLED screens)
 * - 'system' -> class="theme-system" (CSS media query handles the switch)
 */
function applyThemeClass(theme: 'system' | 'dark' | 'light' | 'oled'): void {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-system', 'theme-oled');

  if (theme === 'light') {
    root.classList.add('theme-light');
  } else if (theme === 'oled') {
    root.classList.add('theme-oled');
  } else if (theme === 'system') {
    root.classList.add('theme-system');
  }
  /* 'dark' needs no class — it's the :root default */
}

/**
 * Apply font CSS variables for the selected preset.
 * Updates `--cf-font` and `--cf-font-mono` on the root element.
 */
function applyFontPreset(preset: FontPreset): void {
  const config = FONT_PRESETS[preset];
  const root = document.documentElement;
  root.style.setProperty('--cf-font', config.ui);
  root.style.setProperty('--cf-font-mono', config.mono);
}

/**
 * Injects the global CSS variables, applies the theme class and font
 * preset on mount. Watches for storage changes to update live.
 */
export function useTheme(): void {
  const styleRef = useRef<HTMLStyleElement | null>(null);

  /* Load bundled bundled font CSS once */
  useEffect(() => {
    loadBundledFonts();
  }, []);

  /* Inject the global CSS once */
  useEffect(() => {
    if (!styleRef.current) {
      const style = document.createElement('style');
      style.textContent = CSS_VARS;
      document.head.appendChild(style);
      styleRef.current = style;
    }
  }, []);

  /* Read stored theme + font preset and apply immediately */
  useEffect(() => {
    getSettings().then((s) => {
      applyThemeClass(s.theme);
      applyFontPreset(s.fontPreset);
    });
  }, []);

  /* Listen for live theme/font changes from Settings panel */
  useEffect(() => {
    const unsub = onSettingsChange((changes) => {
      if (changes.theme) {
        applyThemeClass(changes.theme);
      }
      if (changes.fontPreset) {
        applyFontPreset(changes.fontPreset);
      }
    });
    return unsub;
  }, []);
}
