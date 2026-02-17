/**
 * @module layers/L1-structural
 * L1 Structural Compression layer — the entry point for converting
 * between JavaScript data and PAKT AST representation.
 *
 * Re-exports the two core functions from their implementation modules:
 * - {@link compressL1} — JS data -> PAKT AST
 * - {@link decompressL1} — PAKT AST body -> JS data
 *
 * @example
 * ```ts
 * import { compressL1, decompressL1 } from './L1-structural.js';
 *
 * const original = { name: 'Sriinnu', scores: [95, 87, 92] };
 * const doc = compressL1(original, 'json');
 * const restored = decompressL1(doc.body);
 * // deepEqual(original, restored) === true
 * ```
 */

export { compressL1, toScalar, buildBody } from './L1-compress.js';
export { decompressL1, scalarToValue } from './L1-decompress.js';
