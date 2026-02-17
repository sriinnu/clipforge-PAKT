/**
 * @module parser/ast
 * AST node types for the PAKT parser. Every node the parser can
 * produce is defined here. Designed for lossless round-tripping.
 * All nodes carry a {@link SourcePosition} for error reporting.
 */

// -- Source position ---------------------------------------------------------

/**
 * Tracks a node's location in source text for error reporting.
 * @example
 * ```ts
 * const pos: SourcePosition = { line: 1, column: 1, offset: 0 };
 * ```
 */
export interface SourcePosition {
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
  /** Byte offset from start of document */
  offset: number;
}

/**
 * Base interface for all AST nodes. The `type` field is a discriminator.
 * @example
 * ```ts
 * function visit(node: ASTNode) {
 *   switch (node.type) {
 *     case 'keyValue': return handleKV(node);
 *     case 'object':   return handleObj(node);
 *   }
 * }
 * ```
 */
export interface BaseNode {
  type: string;
  position: SourcePosition;
}

// -- Document (root) ---------------------------------------------------------

/**
 * Root node of a PAKT document: headers + optional dictionary + body.
 * @example
 * ```ts
 * const doc: DocumentNode = {
 *   type: 'document', position: pos,
 *   headers: [{ type: 'header', headerType: 'from', value: 'json', position: pos }],
 *   dictionary: null,
 *   body: [{ type: 'keyValue', key: 'name', value: scalar, position: pos }],
 * };
 * ```
 */
export interface DocumentNode extends BaseNode {
  type: 'document';
  headers: HeaderNode[];
  dictionary: DictBlockNode | null;
  body: BodyNode[];
}

// -- Headers -----------------------------------------------------------------

/**
 * `@from` header declaring the original input format.
 * @example
 * ```ts
 * const h: FromHeaderNode = { type: 'header', headerType: 'from', value: 'json', position: pos };
 * ```
 */
export interface FromHeaderNode extends BaseNode {
  type: 'header';
  headerType: 'from';
  value: string;
}

/**
 * `@target` header for L3 tokenizer optimization.
 * @example
 * ```ts
 * const h: TargetHeaderNode = { type: 'header', headerType: 'target', value: 'gpt-4o', position: pos };
 * ```
 */
export interface TargetHeaderNode extends BaseNode {
  type: 'header';
  headerType: 'target';
  value: string;
}

/**
 * `@compress` header declaring an active compression mode.
 * @example
 * ```ts
 * const h: CompressHeaderNode = { type: 'header', headerType: 'compress', value: 'semantic', position: pos };
 * ```
 */
export interface CompressHeaderNode extends BaseNode {
  type: 'header';
  headerType: 'compress';
  value: string;
}

/**
 * `@warning` header flagging lossy or irreversible output.
 * @example
 * ```ts
 * const h: WarningHeaderNode = { type: 'header', headerType: 'warning', value: 'lossy', position: pos };
 * ```
 */
export interface WarningHeaderNode extends BaseNode {
  type: 'header';
  headerType: 'warning';
  value: string;
}

/**
 * `@version` header declaring the PAKT spec version.
 * @example
 * ```ts
 * const h: VersionHeaderNode = { type: 'header', headerType: 'version', value: '0.1.0', position: pos };
 * ```
 */
export interface VersionHeaderNode extends BaseNode {
  type: 'header';
  headerType: 'version';
  value: string;
}

/** Union of all header node types. */
export type HeaderNode =
  | FromHeaderNode
  | TargetHeaderNode
  | CompressHeaderNode
  | WarningHeaderNode
  | VersionHeaderNode;

// -- Dictionary --------------------------------------------------------------

/**
 * Dictionary block (`@dict` ... `@end`) containing alias definitions.
 * @example
 * ```ts
 * const block: DictBlockNode = {
 *   type: 'dictBlock', position: pos,
 *   entries: [{ type: 'dictEntry', alias: '$a', expansion: 'developer', position: pos }],
 * };
 * ```
 */
export interface DictBlockNode extends BaseNode {
  type: 'dictBlock';
  entries: DictEntryNode[];
}

/**
 * Single dictionary entry: alias -> expansion.
 * @example
 * ```ts
 * const e: DictEntryNode = { type: 'dictEntry', alias: '$a', expansion: 'developer', position: pos };
 * ```
 */
export interface DictEntryNode extends BaseNode {
  type: 'dictEntry';
  alias: string;
  expansion: string;
}

// -- Body nodes --------------------------------------------------------------

/**
 * Simple key: value pair (e.g., `name: Sriinnu`).
 * @example
 * ```ts
 * const kv: KeyValueNode = { type: 'keyValue', key: 'name', value: scalar, position: pos };
 * ```
 */
export interface KeyValueNode extends BaseNode {
  type: 'keyValue';
  key: string;
  value: ScalarNode;
}

/**
 * Nested object — key with indented children.
 * @example
 * ```ts
 * // user\n  name: Sriinnu\n  role: developer
 * const obj: ObjectNode = {
 *   type: 'object', key: 'user', children: [kvName, kvRole], position: pos,
 * };
 * ```
 */
export interface ObjectNode extends BaseNode {
  type: 'object';
  key: string;
  children: BodyNode[];
}

/**
 * Tabular array — uniform objects as pipe-delimited rows.
 * PAKT's most powerful compression node.
 * @example
 * ```ts
 * // projects [3]{id|name|status}:\n  1|VAAYU|active\n  2|ClipForge|planning
 * const arr: TabularArrayNode = {
 *   type: 'tabularArray', key: 'projects', count: 3,
 *   fields: ['id', 'name', 'status'], rows: [...], position: pos,
 * };
 * ```
 */
export interface TabularArrayNode extends BaseNode {
  type: 'tabularArray';
  key: string;
  /** Declared element count (from `[N]` annotation) */
  count: number;
  /** Column names (from `{field1|field2|...}` annotation) */
  fields: string[];
  rows: TabularRowNode[];
}

/**
 * Single row in a tabular array (e.g., `1|VAAYU|active`).
 * @example
 * ```ts
 * const row: TabularRowNode = { type: 'tabularRow', values: [n, s1, s2], position: pos };
 * ```
 */
export interface TabularRowNode extends BaseNode {
  type: 'tabularRow';
  values: ScalarNode[];
}

/**
 * Inline array of primitives (e.g., `tags [3]: React,TypeScript,Rust`).
 * @example
 * ```ts
 * const arr: InlineArrayNode = {
 *   type: 'inlineArray', key: 'tags', count: 3, values: [...], position: pos,
 * };
 * ```
 */
export interface InlineArrayNode extends BaseNode {
  type: 'inlineArray';
  key: string;
  count: number;
  values: ScalarNode[];
}

/**
 * List-style array of non-uniform objects (items prefixed with `- `).
 * @example
 * ```ts
 * // events [2]:\n  - type: deploy\n    success: true
 * const arr: ListArrayNode = {
 *   type: 'listArray', key: 'events', count: 2, items: [...], position: pos,
 * };
 * ```
 */
export interface ListArrayNode extends BaseNode {
  type: 'listArray';
  key: string;
  count: number;
  items: ListItemNode[];
}

/**
 * Single item in a list-style array.
 * @example
 * ```ts
 * const item: ListItemNode = { type: 'listItem', children: [kv1, kv2], position: pos };
 * ```
 */
export interface ListItemNode extends BaseNode {
  type: 'listItem';
  children: BodyNode[];
}

// -- Scalars -----------------------------------------------------------------

/**
 * String scalar value.
 * @example
 * ```ts
 * const s: StringScalar = { type: 'scalar', scalarType: 'string', value: 'hello', quoted: false, position: pos };
 * ```
 */
export interface StringScalar extends BaseNode {
  type: 'scalar';
  scalarType: 'string';
  value: string;
  /** Whether the value was quoted in the source */
  quoted: boolean;
}

/**
 * Numeric scalar value.
 * @example
 * ```ts
 * const n: NumberScalar = { type: 'scalar', scalarType: 'number', value: 42, raw: '42', position: pos };
 * ```
 */
export interface NumberScalar extends BaseNode {
  type: 'scalar';
  scalarType: 'number';
  value: number;
  /** Original representation (preserves formatting like "1.0e3") */
  raw: string;
}

/**
 * Boolean scalar value.
 * @example
 * ```ts
 * const b: BooleanScalar = { type: 'scalar', scalarType: 'boolean', value: true, position: pos };
 * ```
 */
export interface BooleanScalar extends BaseNode {
  type: 'scalar';
  scalarType: 'boolean';
  value: boolean;
}

/**
 * Null scalar value.
 * @example
 * ```ts
 * const n: NullScalar = { type: 'scalar', scalarType: 'null', value: null, position: pos };
 * ```
 */
export interface NullScalar extends BaseNode {
  type: 'scalar';
  scalarType: 'null';
  value: null;
}

/**
 * Union of all scalar types. Use `scalarType` to discriminate.
 * @example
 * ```ts
 * function fmt(s: ScalarNode): string {
 *   switch (s.scalarType) {
 *     case 'string':  return s.value;
 *     case 'number':  return s.raw;
 *     case 'boolean': return String(s.value);
 *     case 'null':    return 'null';
 *   }
 * }
 * ```
 */
export type ScalarNode = StringScalar | NumberScalar | BooleanScalar | NullScalar;

// -- Comments ----------------------------------------------------------------

/**
 * Comment node. Preserved in AST for lossless round-tripping.
 * @example
 * ```ts
 * const c: CommentNode = { type: 'comment', text: 'a comment', inline: false, position: pos };
 * ```
 */
export interface CommentNode extends BaseNode {
  type: 'comment';
  text: string;
  /** Whether this is an inline comment (at end of a data line) */
  inline: boolean;
}

// -- Union types -------------------------------------------------------------

/** All body node types that can appear in a document body. */
export type BodyNode =
  | KeyValueNode
  | ObjectNode
  | TabularArrayNode
  | InlineArrayNode
  | ListArrayNode
  | CommentNode;

/** Every AST node type the parser can produce. */
export type ASTNode =
  | DocumentNode
  | HeaderNode
  | DictBlockNode
  | DictEntryNode
  | BodyNode
  | TabularRowNode
  | ListItemNode
  | ScalarNode;

// -- Utility functions -------------------------------------------------------

/**
 * Create a {@link SourcePosition}.
 * @param line - Line number (1-based)
 * @param column - Column number (1-based)
 * @param offset - Byte offset from start of document
 * @example
 * ```ts
 * const pos = createPosition(1, 1, 0);
 * // { line: 1, column: 1, offset: 0 }
 * ```
 */
export function createPosition(line: number, column: number, offset: number): SourcePosition {
  return { line, column, offset };
}

/**
 * Infer a typed scalar node from a raw string. Detection order:
 * null -> boolean -> number -> string (fallback). Only exact
 * lowercase matches are detected (`'true'`, not `'True'`).
 * @param raw - The raw string value to infer a type for
 * @param position - Source position for the resulting node
 * @example
 * ```ts
 * const pos = createPosition(1, 1, 0);
 * inferScalar('42', pos);     // NumberScalar  { value: 42 }
 * inferScalar('true', pos);   // BooleanScalar { value: true }
 * inferScalar('null', pos);   // NullScalar    { value: null }
 * inferScalar('hello', pos);  // StringScalar  { value: 'hello' }
 * ```
 */
export function inferScalar(raw: string, position: SourcePosition): ScalarNode {
  if (raw === 'null') {
    return { type: 'scalar', scalarType: 'null', value: null, position };
  }
  if (raw === 'true') {
    return { type: 'scalar', scalarType: 'boolean', value: true, position };
  }
  if (raw === 'false') {
    return { type: 'scalar', scalarType: 'boolean', value: false, position };
  }
  // Number: optional sign, no leading zeros, optional decimal + exponent
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
    const num = Number(raw);
    if (Number.isFinite(num)) {
      return { type: 'scalar', scalarType: 'number', value: num, raw, position };
    }
  }
  return { type: 'scalar', scalarType: 'string', value: raw, quoted: false, position };
}
