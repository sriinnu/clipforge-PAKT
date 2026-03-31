/**
 * Font preset configuration for the ClipForge desktop app.
 *
 * All woff2 files are self-hosted in `public/fonts/` — zero
 * third-party npm packages, zero CDN calls at runtime.
 * Users can drop .woff2 files into `public/fonts/custom/`.
 */

import type { FontPreset } from './stores/settingsStore';

/** Configuration for a single font preset. */
export interface FontPresetConfig {
  /** Human-readable label shown in the settings UI. */
  label: string;
  /** CSS font-family value for body / UI text. */
  ui: string;
  /** CSS font-family value for code / monospace text. */
  mono: string;
}

/** All available font presets. */
export const FONT_PRESETS: Record<FontPreset, FontPresetConfig> = {
  modern: {
    label: 'Modern',
    ui: "'Inter Variable', 'Inter', sans-serif",
    mono: "'JetBrains Mono Variable', 'JetBrains Mono', monospace",
  },
  classic: {
    label: 'Classic',
    ui: "'IBM Plex Sans', sans-serif",
    mono: "'IBM Plex Mono', monospace",
  },
  rounded: {
    label: 'Rounded',
    ui: "'Nunito Variable', 'Nunito', sans-serif",
    mono: "'Fira Code Variable', 'Fira Code', monospace",
  },
  system: {
    label: 'System',
    ui: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
  },
};

/** @font-face CSS for all self-hosted fonts. Paths relative to public/. */
const FONT_FACE_CSS = `
  @font-face { font-family: 'Inter Variable'; font-display: swap; font-weight: 100 900; src: url('/fonts/inter/inter-latin-wght-normal.woff2') format('woff2'); }
  @font-face { font-family: 'JetBrains Mono Variable'; font-display: swap; font-weight: 100 800; src: url('/fonts/jetbrains-mono/jetbrains-mono-latin-wght-normal.woff2') format('woff2'); }
  @font-face { font-family: 'IBM Plex Sans'; font-display: swap; font-weight: 400; src: url('/fonts/ibm-plex-sans/ibm-plex-sans-latin-400-normal.woff2') format('woff2'); }
  @font-face { font-family: 'IBM Plex Sans'; font-display: swap; font-weight: 500; src: url('/fonts/ibm-plex-sans/ibm-plex-sans-latin-500-normal.woff2') format('woff2'); }
  @font-face { font-family: 'IBM Plex Sans'; font-display: swap; font-weight: 600; src: url('/fonts/ibm-plex-sans/ibm-plex-sans-latin-600-normal.woff2') format('woff2'); }
  @font-face { font-family: 'IBM Plex Mono'; font-display: swap; font-weight: 400; src: url('/fonts/ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2') format('woff2'); }
  @font-face { font-family: 'IBM Plex Mono'; font-display: swap; font-weight: 500; src: url('/fonts/ibm-plex-mono/ibm-plex-mono-latin-500-normal.woff2') format('woff2'); }
  @font-face { font-family: 'Nunito Variable'; font-display: swap; font-weight: 200 1000; src: url('/fonts/nunito/nunito-latin-wght-normal.woff2') format('woff2'); }
  @font-face { font-family: 'Fira Code Variable'; font-display: swap; font-weight: 300 700; src: url('/fonts/fira-code/fira-code-latin-wght-normal.woff2') format('woff2'); }
`;

/** Inject @font-face CSS. Safe to call multiple times. */
let injected = false;
export function loadBundledFonts(): void {
  if (injected) return;
  const style = document.createElement('style');
  style.textContent = FONT_FACE_CSS;
  document.head.appendChild(style);
  injected = true;
}

/** Apply font CSS custom properties to the document root. */
export function applyFontPreset(preset: FontPreset): void {
  const config = FONT_PRESETS[preset];
  const root = document.documentElement;
  root.style.setProperty('--shell-font', config.ui);
  root.style.setProperty('--shell-font-mono', config.mono);
}
