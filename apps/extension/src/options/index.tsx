/**
 * Entry point for the dedicated Options page.
 *
 * Mounted from `options.html`, registered in the manifest under `options_ui`.
 * The Options page hosts the same `<Settings>` panel as the popup but in a
 * full-tab layout with more breathing room than the 350 px popup chrome.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OptionsApp } from './OptionsApp';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <OptionsApp />
    </StrictMode>,
  );
}
