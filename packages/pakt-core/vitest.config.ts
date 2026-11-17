import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  define: { __PAKT_VERSION__: JSON.stringify(version) },
  test: {
    // CLI tests spawn Node.js subprocesses; each cold-start takes 2-5 s.
    // Raise the global timeout so cli-auto.test.ts doesn't flake.
    testTimeout: 15_000,
    include: ['tests/**/*.test.ts'],
    benchmark: {
      include: ['benchmarks/**/*.bench.ts'],
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts'],
    },
  },
});
