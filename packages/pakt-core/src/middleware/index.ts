/**
 * @module middleware
 * PAKT middleware interceptor — automatic tool-result compression.
 *
 * Re-exports the interceptor factory, message optimizer, and all
 * associated types from a single barrel.
 *
 * @example
 * ```ts
 * import { createPaktInterceptor, optimizeMessages } from '@sriinnu/pakt';
 * ```
 */

export { createPaktInterceptor, optimizeMessages } from './interceptor.js';
export type { PaktInterceptor } from './interceptor.js';
export type {
  InterceptorConfig,
  InterceptorResult,
  InterceptorStats,
  OptimizeResult,
  ToolResultMessage,
} from './types.js';
