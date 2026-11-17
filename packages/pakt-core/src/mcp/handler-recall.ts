/**
 * @module mcp/handler-recall
 * `pakt_recall`: read spilled tool output back from the shared spill store.
 *
 * @internal Node.js only (disk-backed store).
 */

import { FileSpillStore } from '../spill/file-store.js';
import { SPILL_ID_PATTERN, type SpillStore } from '../spill/index.js';
import { PaktToolInputError } from './handler-validation.js';
import type { PaktRecallArgs, PaktRecallResult } from './types.js';

let store: SpillStore | undefined;

/** Override the store (tests, or a host that keeps spills elsewhere). */
export function setRecallStore(next: SpillStore | undefined): void {
  store = next;
}

export function handleRecall(args: PaktRecallArgs): PaktRecallResult {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  if (!SPILL_ID_PATTERN.test(id)) {
    throw new PaktToolInputError('id must look like sp_ followed by 16 hex characters');
  }
  store ??= new FileSpillStore();
  const full = store.get(id);
  if (full === undefined) {
    return { id, found: false, text: '', totalLines: 0, startLine: 0, endLine: 0 };
  }
  const lines = full.split('\n');
  const start = Math.max(1, Number(args.startLine ?? 1));
  const end = Math.min(lines.length, Number(args.endLine ?? lines.length));
  if (start > end) {
    throw new PaktToolInputError(`startLine ${start} is after endLine ${end}`);
  }
  return {
    id,
    found: true,
    text: lines.slice(start - 1, end).join('\n'),
    totalLines: lines.length,
    startLine: start,
    endLine: end,
  };
}
