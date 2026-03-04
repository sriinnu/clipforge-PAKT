/**
 * @module parser/token-matchers
 * Individual token matching functions for the PAKT tokenizer.
 * These are self-contained scanner routines that identify and extract
 * specific token types from a source line.
 *
 * Also exports the shared {@link TokenizerError} class, {@link Token}
 * interface, {@link TokenType} union, and the `tok` factory used by
 * both this module and the main tokenizer.
 */

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

/**
 * Every token type the PAKT lexer can produce.
 * Used as the discriminator on {@link Token}.
 */
export type TokenType =
  | 'HEADER' // @from, @target, @version, @compress, @warning
  | 'DICT_START' // @dict
  | 'DICT_END' // @end
  | 'KEY' // any key identifier before ':'
  | 'COLON' // :
  | 'VALUE' // value after ': '
  | 'PIPE' // |
  | 'BRACKET_OPEN' // [
  | 'BRACKET_CLOSE' // ]
  | 'BRACE_OPEN' // {
  | 'BRACE_CLOSE' // }
  | 'COMMA' // ,
  | 'DASH' // - (list item prefix)
  | 'COMMENT' // % comment
  | 'NEWLINE' // \n
  | 'INDENT' // leading spaces (value = space count)
  | 'QUOTED_STRING' // "..."
  | 'NUMBER' // bare number
  | 'EOF'; // end of input

/**
 * A single lexical token emitted by the tokenizer.
 * @example
 * ```ts
 * const tok: Token = { type: 'KEY', value: 'name', line: 2, column: 3, offset: 14 };
 * ```
 */
export interface Token {
  /** Discriminating token type */
  type: TokenType;
  /** Raw string content of the token */
  value: string;
  /** 1-based line number */
  line: number;
  /** 1-based column number */
  column: number;
  /** Byte offset from start of input */
  offset: number;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Error thrown when the tokenizer encounters illegal input.
 */
export class TokenizerError extends Error {
  /** 1-based line where the error was detected */
  line: number;
  /** 1-based column where the error was detected */
  column: number;

  constructor(message: string, line: number, column: number) {
    super(`Tokenizer error at ${line}:${column} — ${message}`);
    this.name = 'TokenizerError';
    this.line = line;
    this.column = column;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Regular expression for valid PAKT numeric literals. */
const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Create a token convenience helper. */
export function tok(
  type: TokenType,
  value: string,
  line: number,
  column: number,
  offset: number,
): Token {
  return { type, value, line, column, offset };
}

/** Set of header keywords recognised by PAKT directives. */
export const HEADER_KEYWORDS = new Set(['from', 'target', 'version', 'compress', 'warning']);

// ---------------------------------------------------------------------------
// Directive matching
// ---------------------------------------------------------------------------

/**
 * Is `col` pointing at a valid @ directive start?
 * The @ must be the first non-space character on the line.
 * @param line - The full source line
 * @param col - Current column index (0-based)
 * @returns True if col is at the first non-space position
 */
export function isDirectiveStart(line: string, col: number): boolean {
  for (let i = 0; i < col; i++) {
    if (line[i] !== ' ') return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Quoted string scanner
// ---------------------------------------------------------------------------

/**
 * Scan a double-quoted string starting at `start`, handling escapes.
 * Returns the token and the index *after* the closing quote.
 * @param line - The full source line
 * @param start - Index of the opening quote character
 * @param lineNum - 1-based line number for the token
 * @param byteOffset - Byte offset of the opening quote in the full input
 * @returns Object with the parsed token and the end index
 * @throws {TokenizerError} On unterminated string
 */
export function scanQuotedString(
  line: string,
  start: number,
  lineNum: number,
  byteOffset: number,
): { token: Token; end: number } {
  let i = start + 1; // skip opening quote
  let value = '';
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === '\\' && i + 1 < line.length) {
      const next = line[i + 1]!;
      switch (next) {
        case '\\':
          value += '\\';
          break;
        case '"':
          value += '"';
          break;
        case 'n':
          value += '\n';
          break;
        case 't':
          value += '\t';
          break;
        case 'r':
          value += '\r';
          break;
        default:
          value += `\\${next}`;
          break;
      }
      i += 2;
      continue;
    }
    if (ch === '"') {
      return {
        token: tok('QUOTED_STRING', value, lineNum, start + 1, byteOffset),
        end: i + 1,
      };
    }
    value += ch;
    i++;
  }
  throw new TokenizerError('Unterminated quoted string', lineNum, start + 1);
}

// ---------------------------------------------------------------------------
// Word / key scanner
// ---------------------------------------------------------------------------

/**
 * Scan an unquoted word / key starting at `start`.
 * Reads until a structural delimiter or space is encountered.
 * @param line - The full source line
 * @param start - Index of the first character
 * @param lineNum - 1-based line number for the token
 * @param byteOffset - Byte offset of the first character in the full input
 * @returns Object with the parsed token and the end index
 */
export function scanWord(
  line: string,
  start: number,
  lineNum: number,
  byteOffset: number,
): { token: Token; end: number } {
  let i = start;
  // Read until we hit a structural delimiter or space
  while (i < line.length && !isDelimiter(line[i]!)) {
    i++;
  }
  const word = line.slice(start, i);
  // Determine if it's a NUMBER or KEY
  const type: TokenType = NUMBER_RE.test(word) ? 'NUMBER' : 'KEY';
  return {
    token: tok(type, word, lineNum, start + 1, byteOffset),
    end: i,
  };
}

// ---------------------------------------------------------------------------
// Delimiter check
// ---------------------------------------------------------------------------

/**
 * Characters that terminate a word scan.
 * @param ch - Single character to test
 * @returns True if the character is a structural delimiter
 */
export function isDelimiter(ch: string): boolean {
  return (
    ch === ' ' ||
    ch === ':' ||
    ch === '|' ||
    ch === ',' ||
    ch === '[' ||
    ch === ']' ||
    ch === '{' ||
    ch === '}' ||
    ch === '%' ||
    ch === '"'
  );
}

// ---------------------------------------------------------------------------
// Inline comment finder
// ---------------------------------------------------------------------------

/**
 * Find the index of an inline comment in a value string.
 * An inline comment is ` %` (space then percent) outside of quotes.
 * Returns the index of the `%`, or -1 if not found.
 * @param text - The text to search for inline comments
 * @returns Index of the `%` character, or -1 if not found
 */
export function findInlineComment(text: string): number {
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (ch === '\\' && inQuote) {
      i++; // skip escaped char
      continue;
    }
    // Inline comment requires a preceding space: " %"
    if (!inQuote && ch === '%' && i > 0 && text[i - 1] === ' ') {
      return i;
    }
  }
  return -1;
}
