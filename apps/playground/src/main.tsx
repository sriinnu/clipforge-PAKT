/**
 * Playground entry point.
 * Loads bundled fonts, applies the default "modern" font preset,
 * and mounts the React root.
 */

import { createRoot } from 'react-dom/client';
import App from './App';
import { applyFontPreset, loadBundledFonts } from './fonts';
import './styles.css';

/* Bundle all bundled font woff2 files into the build */
loadBundledFonts();

/* Default to the "modern" preset (Inter + JetBrains Mono) */
applyFontPreset('modern');

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(<App />);
