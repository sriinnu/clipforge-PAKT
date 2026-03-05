import { defineConfig } from 'vitest/config';

export default defineConfig({
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
