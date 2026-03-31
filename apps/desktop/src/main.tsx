/**
 * Desktop app entry point.
 * Loads bundled fonts, applies the persisted font preset, and mounts
 * the React root.
 */

import { createRoot } from 'react-dom/client';
import App from './App';
import { applyFontPreset, loadBundledFonts } from './fonts';
import { useSettingsStore } from './stores/settingsStore';
import './styles.css';

/* Load all bundled font woff2 files into the page */
loadBundledFonts();

/* Apply the persisted font preset before first paint */
const initialPreset = useSettingsStore.getState().fontPreset;
applyFontPreset(initialPreset);

/* Re-apply whenever the store changes */
useSettingsStore.subscribe((state) => {
  applyFontPreset(state.fontPreset);
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(<App />);
