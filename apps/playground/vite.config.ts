import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const { version } = JSON.parse(
  readFileSync(resolve(__dirname, '../../packages/pakt-core/package.json'), 'utf8'),
) as { version: string };

export default defineConfig({
  define: {
    __PAKT_VERSION__: JSON.stringify(version),
  },
  build: {
    minify: 'esbuild',
    cssMinify: 'esbuild',
    sourcemap: false,
  },
  plugins: [react()],
  server: {
    port: 4174,
  },
  worker: {
    format: 'es',
  },
});
