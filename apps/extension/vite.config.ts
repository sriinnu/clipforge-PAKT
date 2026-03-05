import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite config — used by `vite dev` (popup dev server only).
 *
 * Production builds run via `build.mjs` which calls Vite's build() API
 * three times to produce fully self-contained IIFE bundles for the
 * background service worker and content script, plus an ES module bundle
 * for the React popup.
 */
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
