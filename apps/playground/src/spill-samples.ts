/** A long build log whose failure sits at the very end: the reason the gist keeps a tail. */
export const SPILL_SAMPLE = [
  '$ pnpm -r run build',
  ...Array.from({ length: 260 }, (_, i) => {
    const pkg = ['core', 'cli', 'mcp', 'hooks', 'spill'][i % 5];
    return `packages/${pkg} build: src/module-${String(i).padStart(3, '0')}.ts compiled in ${((i * 7) % 90) + 10}ms`;
  }),
  "packages/hooks build: src/hooks/bash-spill.ts(212,7): error TS2322: Type 'string' is not assignable to type 'number'.",
  'packages/hooks build: Found 1 error in src/hooks/bash-spill.ts:212',
  ' ELIFECYCLE  Command failed with exit code 2.',
].join('\n');
