/**
 * @module serializer
 * Re-exports the compact PAKT serializer and pretty printer.
 *
 * @example
 * ```ts
 * import { serialize, prettyPrint } from './serializer/index.js';
 * ```
 */
export { serialize } from './serialize.js';
export { prettyPrint } from './pretty.js';
export type { PrettyOptions } from './pretty.js';
