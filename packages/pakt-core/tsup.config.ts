import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  entry: ['src/index.ts', 'src/universal.ts', 'src/cli.ts', 'src/meta.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: true,
  // VERSION comes from package.json so it cannot drift from the release.
  define: { __PAKT_VERSION__: JSON.stringify(version) },
});
