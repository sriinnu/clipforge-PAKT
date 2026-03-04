/**
 * @module async
 * Async wrappers for the PAKT compression and decompression pipelines.
 *
 * These functions wrap the synchronous {@link compress} and {@link decompress}
 * with event-loop yields so the main thread stays responsive during large
 * payloads. The API contract is Promise-based, making them drop-in replacements
 * for async/await pipelines (e.g., AI inference chains, streaming ingestion).
 */

import { compress } from './compress.js';
import { decompress } from './decompress.js';
import type { DecompressResult, PaktFormat, PaktOptions, PaktResult } from './types.js';

// ---------------------------------------------------------------------------
// Internal yield helper
// ---------------------------------------------------------------------------

/**
 * Yield control to the event loop via a zero-delay setTimeout.
 * This lets pending I/O, timers, and microtasks execute between
 * CPU-bound compression stages, keeping the runtime responsive.
 *
 * @returns A promise that resolves on the next macrotask
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// compressAsync
// ---------------------------------------------------------------------------

/**
 * Async version of {@link compress}.
 *
 * Yields to the event loop before and after the synchronous compression
 * pipeline so callers can interleave other work (network I/O, progress
 * updates, etc.) without blocking.
 *
 * The result is identical to the synchronous `compress()` — this wrapper
 * does not alter the compression logic, only the scheduling.
 *
 * @param input - The text to compress (JSON, YAML, CSV, Markdown, or plain text)
 * @param options - Compression options (layers, target model, etc.)
 * @returns Promise resolving to the same {@link PaktResult} as sync compress
 *
 * @example
 * ```ts
 * import { compressAsync } from '@sriinnu/pakt';
 *
 * const result = await compressAsync(largeJson);
 * console.log(result.savings.totalPercent);
 * ```
 */
export async function compressAsync(
  input: string,
  options?: Partial<PaktOptions>,
): Promise<PaktResult> {
  // Yield before the CPU-bound work so pending callbacks can execute
  await yieldToEventLoop();

  // Run the synchronous compression pipeline
  const result = compress(input, options);

  // Yield after completion so downstream consumers get a chance to run
  await yieldToEventLoop();

  return result;
}

// ---------------------------------------------------------------------------
// decompressAsync
// ---------------------------------------------------------------------------

/**
 * Async version of {@link decompress}.
 *
 * Yields to the event loop before and after the synchronous decompression
 * pipeline. Useful in server-side handlers and streaming pipelines where
 * blocking the thread on a large payload would stall other requests.
 *
 * The result is identical to the synchronous `decompress()`.
 *
 * @param pakt - The PAKT-formatted string to decompress
 * @param outputFormat - Desired output format (defaults to the original
 *   format from the `@from` header)
 * @returns Promise resolving to the same {@link DecompressResult} as sync decompress
 *
 * @example
 * ```ts
 * import { decompressAsync } from '@sriinnu/pakt';
 *
 * const { text, data } = await decompressAsync(paktString, 'json');
 * ```
 */
export async function decompressAsync(
  pakt: string,
  outputFormat?: PaktFormat,
): Promise<DecompressResult> {
  // Yield before the CPU-bound work
  await yieldToEventLoop();

  // Run the synchronous decompression pipeline
  const result = decompress(pakt, outputFormat);

  // Yield after completion
  await yieldToEventLoop();

  return result;
}
