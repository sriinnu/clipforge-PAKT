import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import {
  copyFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'fs';

/**
 * Chrome MV3 extension build config.
 *
 * Builds three entry points (popup, background, content script)
 * and copies static assets (manifest.json, icons, popup.html) into dist/.
 *
 * Each entry is self-contained (no code splitting) since Chrome MV3
 * service workers and content scripts cannot dynamically import chunks.
 */
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-extension-assets',
      writeBundle() {
        const dist = resolve(__dirname, 'dist');

        // Copy manifest.json
        copyFileSync(
          resolve(__dirname, 'manifest.json'),
          resolve(dist, 'manifest.json'),
        );

        // Write popup.html with anti-flash dark bg + built popup.js
        writeFileSync(
          resolve(dist, 'popup.html'),
          `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClipForge</title>
  <style>html,body{margin:0;padding:0;background:#0f0d1a;color:#e8e6f0;width:350px;overflow-x:hidden}</style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./popup.js"></script>
</body>
</html>`,
        );

        // Copy icons
        const iconsDir = resolve(dist, 'icons');
        if (!existsSync(iconsDir)) {
          mkdirSync(iconsDir, { recursive: true });
        }
        for (const size of ['16', '48', '128']) {
          const name = `icon-${size}.png`;
          const src = resolve(__dirname, 'icons', name);
          if (existsSync(src)) {
            copyFileSync(src, resolve(iconsDir, name));
          }
        }
      },
    },
  ],

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: process.env.NODE_ENV === 'development',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.tsx'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        content: resolve(__dirname, 'src/content/content-script.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        // Keep shared code as chunks. The popup can load chunks via
        // module scripts, and the content/background scripts import
        // them as static ES module imports (supported in Chrome 120+).
      },
    },
  },

  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
