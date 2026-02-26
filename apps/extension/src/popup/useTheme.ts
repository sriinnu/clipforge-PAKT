/**
 * Custom hook to manage theme application (system/dark/light).
 *
 * Reads the `theme` setting from chrome.storage.sync, applies the correct
 * CSS class to the `<html>` element, and listens for storage changes so the
 * theme updates in real time when the user toggles it in Settings.
 */

import { useEffect, useRef } from 'react';
import { getSettings, onSettingsChange } from '../shared/storage';
import { CSS_VARS } from './styles';

/**
 * Map the stored theme value to a CSS class on <html>.
 * - 'dark'   -> no extra class (dark is the :root default)
 * - 'light'  -> class="theme-light"
 * - 'system' -> class="theme-system" (CSS media query handles the switch)
 */
function applyThemeClass(theme: 'system' | 'dark' | 'light'): void {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-system');

  if (theme === 'light') {
    root.classList.add('theme-light');
  } else if (theme === 'system') {
    root.classList.add('theme-system');
  }
  /* 'dark' needs no class — it's the :root default */
}

/**
 * Injects the global CSS variables and applies the theme class on mount.
 * Watches for storage changes to update the theme live without a reload.
 */
export function useTheme(): void {
  const styleRef = useRef<HTMLStyleElement | null>(null);

  /* Inject the global CSS once */
  useEffect(() => {
    if (!styleRef.current) {
      const style = document.createElement('style');
      style.textContent = CSS_VARS;
      document.head.appendChild(style);
      styleRef.current = style;
    }
  }, []);

  /* Read stored theme and apply immediately */
  useEffect(() => {
    getSettings().then((s) => applyThemeClass(s.theme));
  }, []);

  /* Listen for live theme changes from Settings panel */
  useEffect(() => {
    const unsub = onSettingsChange((changes) => {
      if (changes.theme) {
        applyThemeClass(changes.theme);
      }
    });
    return unsub;
  }, []);
}
