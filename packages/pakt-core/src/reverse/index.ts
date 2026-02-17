/**
 * @module reverse
 * Reverse pipeline for converting PAKT AST back to various output formats.
 *
 * Each module exports a single function that takes the body nodes from a
 * PAKT AST and returns a formatted string in the target format.
 *
 * @example
 * ```ts
 * import { toJson, toYaml, toCsv, toMarkdown, toText } from './reverse/index.js';
 *
 * const json = toJson(document.body);
 * const yaml = toYaml(document.body);
 * const csv  = toCsv(document.body);
 * const md   = toMarkdown(document.body);
 * const text = toText(document.body);
 * ```
 */

export { toJson } from './to-json.js';
export { toYaml } from './to-yaml.js';
export { toCsv } from './to-csv.js';
export { toMarkdown } from './to-markdown.js';
export { toText } from './to-text.js';
export {
  scalarToJS,
  bodyToObject,
  bodyToValue,
  nodeToEntry,
  tabularToArray,
  inlineToArray,
  listToArray,
  listItemToObject,
} from './helpers.js';
