import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const isRelease = process.env.CF_RELEASE === '1';

const { version } = JSON.parse(
  readFileSync(resolve(__dirname, '../../packages/pakt-core/package.json'), 'utf8'),
) as { version: string };

export default defineConfig({
  define: {
    __PAKT_VERSION__: JSON.stringify(version),
  },
  build: {
    sourcemap: !isRelease,
  },
  plugins: [react()],
  server: {
    port: 4174,
  },
  worker: {
    format: 'es',
  },
});
