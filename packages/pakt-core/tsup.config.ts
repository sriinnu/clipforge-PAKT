import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: false,
});
