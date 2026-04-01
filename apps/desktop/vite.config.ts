import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const isRelease = process.env.CF_RELEASE === '1';

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
    sourcemap: !isRelease,
  },
});
