/**
 * Font preset definitions for ClipForge.
 *
 * Each preset provides a UI (sans-serif) font and a monospace font.
 * All woff2 files are self-hosted in the `fonts/` directory — zero
 * third-party npm packages, zero CDN calls at runtime.
 *
 * Presets: Modern (Inter + JetBrains Mono), Classic (IBM Plex),
 * Rounded (Nunito + Fira Code), System (OS defaults).
 */

/** Identifier for one of the built-in font presets. */
export type FontPreset = 'modern' | 'classic' | 'rounded' | 'system';

/** All valid font preset identifiers, used for runtime validation. */
export const FONT_PRESET_IDS: readonly FontPreset[] = ['modern', 'classic', 'rounded', 'system'];

/** Configuration for a single font preset. */
export interface FontPresetConfig {
  /** Human-readable label shown in the settings UI. */
  label: string;
  /** CSS font-family value for body / UI text. */
  ui: string;
  /** CSS font-family value for code / monospace text. */
  mono: string;
}

/**
 * Map of all available font presets.
 *
 * - **Modern**: Inter + JetBrains Mono (default — clean, tight, modern)
 * - **Classic**: IBM Plex Sans + IBM Plex Mono (professional, readable)
 * - **Rounded**: Nunito + Fira Code (friendly, approachable)
 * - **System**: OS default font stacks (zero download, fastest)
 */
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
    ui: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    mono: "'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
  },
};

/** Runtime guard — checks whether a value is a valid FontPreset. */
export function isFontPreset(value: unknown): value is FontPreset {
  return typeof value === 'string' && FONT_PRESET_IDS.includes(value as FontPreset);
}

/**
 * @font-face declarations for all self-hosted fonts.
 * Paths are relative to the app root (extension: next to manifest.json,
 * desktop: public/ dir). Users can drop .woff2 files into fonts/custom/
 * for their own fonts.
 */
const FONT_FACE_CSS = `
  @font-face {
    font-family: 'Inter Variable';
    font-style: normal;
    font-display: swap;
    font-weight: 100 900;
    src: url('./fonts/inter/inter-latin-wght-normal.woff2') format('woff2');
  }
  @font-face {
    font-family: 'JetBrains Mono Variable';
    font-style: normal;
    font-display: swap;
    font-weight: 100 800;
    src: url('./fonts/jetbrains-mono/jetbrains-mono-latin-wght-normal.woff2') format('woff2');
  }
  @font-face {
    font-family: 'IBM Plex Sans';
    font-style: normal;
    font-display: swap;
    font-weight: 400;
    src: url('./fonts/ibm-plex-sans/ibm-plex-sans-latin-400-normal.woff2') format('woff2');
  }
  @font-face {
    font-family: 'IBM Plex Sans';
    font-style: normal;
    font-display: swap;
    font-weight: 500;
    src: url('./fonts/ibm-plex-sans/ibm-plex-sans-latin-500-normal.woff2') format('woff2');
  }
  @font-face {
    font-family: 'IBM Plex Sans';
    font-style: normal;
    font-display: swap;
    font-weight: 600;
    src: url('./fonts/ibm-plex-sans/ibm-plex-sans-latin-600-normal.woff2') format('woff2');
  }
  @font-face {
    font-family: 'IBM Plex Mono';
    font-style: normal;
    font-display: swap;
    font-weight: 400;
    src: url('./fonts/ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2') format('woff2');
  }
  @font-face {
    font-family: 'IBM Plex Mono';
    font-style: normal;
    font-display: swap;
    font-weight: 500;
    src: url('./fonts/ibm-plex-mono/ibm-plex-mono-latin-500-normal.woff2') format('woff2');
  }
  @font-face {
    font-family: 'Nunito Variable';
    font-style: normal;
    font-display: swap;
    font-weight: 200 1000;
    src: url('./fonts/nunito/nunito-latin-wght-normal.woff2') format('woff2');
  }
  @font-face {
    font-family: 'Fira Code Variable';
    font-style: normal;
    font-display: swap;
    font-weight: 300 700;
    src: url('./fonts/fira-code/fira-code-latin-wght-normal.woff2') format('woff2');
  }
`;

/**
 * Inject @font-face CSS into the document head.
 * Call once at app startup. Safe to call multiple times — only injects once.
 */
let fontsInjected = false;
export function loadBundledFonts(): void {
  if (fontsInjected) return;
  const style = document.createElement('style');
  style.textContent = FONT_FACE_CSS;
  document.head.appendChild(style);
  fontsInjected = true;
}
