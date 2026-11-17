/**
 * @module spill/file-store
 * Disk-backed {@link SpillStore} shared across processes (a hook or library
 * spills, the MCP server's `pakt_recall` reads).
 *
 * @internal Node.js only. Spilled tool output can hold secrets, so the
 * directory is created 0700 and each file 0600. Files older than `maxAgeMs`
 * are pruned when the store is opened.
 */

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SPILL_ID_PATTERN, type SpillStore } from './index.js';

/** Default retention for spilled content: 7 days. */
export const DEFAULT_SPILL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** `PAKT_SPILL_DIR`, falling back to `~/.pakt/spill`. */
export function defaultSpillDir(): string {
  return process.env.PAKT_SPILL_DIR ?? join(homedir(), '.pakt', 'spill');
}

export class FileSpillStore implements SpillStore {
  readonly dir: string;

  constructor(dir: string = defaultSpillDir(), maxAgeMs: number = DEFAULT_SPILL_MAX_AGE_MS) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.prune(maxAgeMs);
  }

  put(id: string, content: string): void {
    if (!SPILL_ID_PATTERN.test(id)) throw new Error(`invalid spill id: ${id}`);
    writeFileSync(join(this.dir, `${id}.txt`), content, { mode: 0o600 });
  }

  get(id: string): string | undefined {
    // The id pattern is the path-traversal guard: only sp_<16 hex> resolves.
    if (!SPILL_ID_PATTERN.test(id)) return undefined;
    const path = join(this.dir, `${id}.txt`);
    try {
      const text = readFileSync(path, 'utf8');
      // A recall marks the spill as in use, so retention counts from last use.
      try {
        const now = new Date();
        utimesSync(path, now, now);
      } catch {}
      return text;
    } catch {
      return undefined;
    }
  }

  /** Delete spill files older than `maxAgeMs`. Returns how many were removed. */
  prune(maxAgeMs: number): number {
    let removed = 0;
    const cutoff = Date.now() - maxAgeMs;
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return 0;
    }
    for (const name of names) {
      if (!/^sp_[0-9a-f]{16}\.txt$/.test(name)) continue;
      const path = join(this.dir, name);
      try {
        if (statSync(path).mtimeMs < cutoff) {
          unlinkSync(path);
          removed++;
        }
      } catch {}
    }
    return removed;
  }
}
