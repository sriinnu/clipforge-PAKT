/**
 * @module batch
 * Batch compression with bounded concurrency and per-item error isolation.
 *
 * This module provides {@link compressBatch} for processing multiple inputs
 * concurrently. It uses a semaphore pattern to cap parallelism and reports
 * progress via an optional callback — useful for progress bars and logging
 * in AI data-preparation pipelines.
 */

import { compressAsync } from './async.js';
import type { PaktOptions, PaktResult } from './types.js';

// ---------------------------------------------------------------------------
// Batch types
// ---------------------------------------------------------------------------

/**
 * Options for {@link compressBatch}. Extends the standard compression
 * options with concurrency control and progress tracking.
 *
 * @example
 * ```ts
 * const opts: BatchOptions = {
 *   concurrency: 5,
 *   onProgress: (done, total) => console.log(`${done}/${total}`),
 *   layers: { structural: true, dictionary: true },
 * };
 * ```
 */
export interface BatchOptions extends Partial<PaktOptions> {
  /** Max concurrent compressions. @default 10 */
  concurrency?: number;

  /** Called after each item completes (success or failure). */
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Result for a single item in a batch operation.
 *
 * When compression succeeds, `result` contains the {@link PaktResult}
 * and `error` is undefined. When it fails, `result` is `null` and
 * `error` holds the message.
 *
 * @example
 * ```ts
 * const item: BatchItemResult = {
 *   index: 0,
 *   result: { compressed: '...', originalTokens: 50, ... },
 * };
 * ```
 */
export interface BatchItemResult {
  /** Index of the item in the input array. */
  index: number;

  /** Compression result (null if failed). */
  result: PaktResult | null;

  /** Error message if compression failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Semaphore — bounded concurrency primitive
// ---------------------------------------------------------------------------

/**
 * A simple counting semaphore for limiting concurrent async operations.
 * Each `acquire()` returns a promise that resolves when a slot opens.
 * Call the returned `release` function when the operation finishes.
 */
class Semaphore {
  /** Number of currently available slots. */
  private available: number;

  /** Queue of waiters blocked on acquire(). */
  private waiters: Array<() => void> = [];

  /**
   * Create a semaphore with the given number of permits.
   * @param permits - Maximum concurrent operations allowed
   */
  constructor(permits: number) {
    this.available = permits;
  }

  /**
   * Acquire a permit. If none are available, the returned promise
   * blocks until one is released.
   * @returns A release function to call when the work is done
   */
  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      // Slot available — take it immediately
      this.available--;
      return () => this.release();
    }

    // No slot — enqueue and wait for a release
    return new Promise<() => void>((resolve) => {
      this.waiters.push(() => {
        this.available--;
        resolve(() => this.release());
      });
    });
  }

  /**
   * Release a permit back to the pool, unblocking the next waiter
   * if one exists.
   */
  private release(): void {
    this.available++;
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }
}

// ---------------------------------------------------------------------------
// compressBatch
// ---------------------------------------------------------------------------

/**
 * Compress multiple inputs concurrently with bounded parallelism.
 *
 * Individual failures are captured in {@link BatchItemResult.error} —
 * the function never throws. Results are returned in the same order
 * as the input array regardless of completion order.
 *
 * @param inputs - Array of strings to compress
 * @param options - Batch options (concurrency, progress callback, compression options)
 * @returns Array of {@link BatchItemResult} in input order
 *
 * @example
 * ```ts
 * import { compressBatch } from '@sriinnu/pakt';
 *
 * const results = await compressBatch(
 *   ['{"a":1}', '{"b":2}', '{"c":3}'],
 *   {
 *     concurrency: 2,
 *     onProgress: (done, total) => console.log(`${done}/${total}`),
 *   },
 * );
 *
 * for (const item of results) {
 *   if (item.error) console.error(`Item ${item.index} failed: ${item.error}`);
 *   else console.log(`Item ${item.index}: ${item.result!.savings.totalPercent}% saved`);
 * }
 * ```
 */
export async function compressBatch(
  inputs: string[],
  options?: BatchOptions,
): Promise<BatchItemResult[]> {
  const { concurrency = 10, onProgress, ...compressOptions } = options ?? {};

  // Pre-allocate the results array so items land in their original index
  const results: BatchItemResult[] = new Array(inputs.length);

  // Track completed count for progress reporting
  let completed = 0;

  // Create a semaphore to enforce the concurrency cap
  const semaphore = new Semaphore(concurrency);

  // Launch all tasks — the semaphore gates how many run at once
  const tasks = inputs.map(async (input, index) => {
    const release = await semaphore.acquire();

    try {
      // Delegate to the async wrapper (which yields to the event loop)
      const result = await compressAsync(input, compressOptions);
      results[index] = { index, result };
    } catch (err: unknown) {
      // Capture the error without throwing
      const message = err instanceof Error ? err.message : String(err);
      results[index] = { index, result: null, error: message };
    } finally {
      release();
      completed++;
      // Fire progress callback after every completion
      if (onProgress) {
        onProgress(completed, inputs.length);
      }
    }
  });

  // Wait for every task to settle
  await Promise.all(tasks);

  return results;
}
