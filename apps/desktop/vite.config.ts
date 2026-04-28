import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],

  // Prevent Vite from obscuring Rust errors
  clearScreen: false,

  server: {
    // Tauri expects a fixed port; fail if that port is not available
    strictPort: true,
    port: 1420,
  },

  // Env variables with these prefixes are exposed to the Tauri frontend
  envPrefix: ['VITE_', 'TAURI_'],

  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari14',
    minify: 'esbuild',
    cssMinify: 'esbuild',
    sourcemap: false,
    // Bumped because we hand-split the largest deps below; the runtime
    // pakt-core chunk is intentionally allowed to exceed 500 kB.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        /**
         * Manual vendor splits.
         *
         * The desktop bundle would otherwise ship as one ~3.4 MB chunk.
         * Splitting these out lets the WebView cache the rarely-changing
         * vendor code separately from the app code, and downloads happen
         * in parallel rather than serialized in a single file.
         *
         *  - `react-vendor`: react / react-dom / scheduler
         *  - `pakt-core`:    @sriinnu/pakt + its tokenizer payload
         *  - `tauri-api`:    eagerly-imported pieces of @tauri-apps/api
         *  - `vendor`:       everything else from node_modules
         */
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;

          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'react-vendor';
          }

          if (id.includes('@sriinnu/pakt') || id.includes('gpt-tokenizer')) {
            return 'pakt-core';
          }

          if (id.includes('@tauri-apps/')) {
            return 'tauri-api';
          }

          return 'vendor';
        },
      },
    },
  },
});
