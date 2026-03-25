/**
 * Extension build script — runs three Vite builds sequentially.
 *
 * Vite 6 does not support exporting a config array, so we use the
 * programmatic `build()` API directly to produce three self-contained
 * output files:
 *
 *   dist/popup.js      — ES module, React UI (may have shared chunks)
 *   dist/background.js — IIFE, fully inlined service worker
 *   dist/content.js    — IIFE, fully inlined content script
 *
 * IIFE format for background and content ensures no runtime import()
 * calls that could fail inside the Chrome extension sandbox.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === 'development';
const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));
const APP_VERSION = packageJson.version;

const sharedAlias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@sriinnu/pakt': resolve(__dirname, '../../packages/pakt-core/src/index.ts'),
};
const sharedDefine = { __CLIPFORGE_VERSION__: JSON.stringify(APP_VERSION) };
const sharedBuild = {
  target: 'chrome120',
  sourcemap: isDev,
};

// ---------------------------------------------------------------------------
// 1. Popup — ES module, React, may produce shared chunks
// ---------------------------------------------------------------------------
await build({
  plugins: [
    react(),
    {
      name: 'copy-extension-assets',
      writeBundle() {
        const dist = resolve(__dirname, 'dist');

        copyFileSync(resolve(__dirname, 'manifest.json'), resolve(dist, 'manifest.json'));

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

        const iconsDir = resolve(dist, 'icons');
        if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });
        for (const size of ['16', '48', '128']) {
          const name = `icon-${size}.png`;
          const src = resolve(__dirname, 'icons', name);
          if (existsSync(src)) copyFileSync(src, resolve(iconsDir, name));
        }
      },
    },
  ],
  resolve: { alias: sharedAlias },
  define: sharedDefine,
  build: {
    ...sharedBuild,
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { popup: resolve(__dirname, 'src/popup/index.tsx') },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});

// ---------------------------------------------------------------------------
// 2. Background service worker — IIFE, fully self-contained
// ---------------------------------------------------------------------------
await build({
  resolve: { alias: sharedAlias },
  define: sharedDefine,
  build: {
    ...sharedBuild,
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/background/service-worker.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'background.js',
      },
    },
  },
});

// ---------------------------------------------------------------------------
// 3. Content script — IIFE, fully self-contained
// ---------------------------------------------------------------------------
await build({
  resolve: { alias: sharedAlias },
  define: sharedDefine,
  build: {
    ...sharedBuild,
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/content/content-script.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'content.js',
      },
    },
  },
});
