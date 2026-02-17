/**
 * @module parser
 * Public API for the PAKT parser — tokenizer, parser, and AST types.
 *
 * @example
 * ```ts
 * import { parse, tokenize } from '@yugenlab/pakt/parser';
 *
 * const tokens = tokenize('@from json\nname: Alice');
 * const doc    = parse('@from json\nname: Alice');
 * ```
 */

export { parse, PaktParseError } from './parser.js';
export { tokenize } from './tokenizer.js';
export type { Token, TokenType } from './tokenizer.js';
export { TokenizerError } from './tokenizer.js';
export * from './ast.js';
