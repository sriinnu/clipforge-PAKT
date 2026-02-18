/**
 * Entry point for the ClipForge browser extension popup.
 * Mounts the React app into the #root div defined in popup.html.
 * Wraps the entire tree in an ErrorBoundary to prevent crashes.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Popup } from './Popup';
import { ErrorBoundary } from './ErrorBoundary';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <Popup />
      </ErrorBoundary>
    </StrictMode>,
  );
}
