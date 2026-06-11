import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Use worker threads instead of the default 'forks' pool: on WSL2 with the
      // repo on an NTFS mount (/mnt/c), child-process fork spawning is slow enough
      // that vitest's pool times out ("Failed to start forks worker") before any
      // test runs. Threads avoid the fork entirely and are safe on Linux/macOS CI.
      pool: 'threads',
      environment: 'jsdom',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      setupFiles: ['./src/vitest.setup.ts'],
    },
  }),
);
