/**
 * @module parser/tokenizer
 * Lexer for PAKT-formatted text. Converts raw input into a flat
 * token stream consumed by the recursive-descent parser.
 *
 * Design constraints:
 * - Single-pass, line-by-line processing
 * - Tracks indentation (space count) per line
 * - Rejects tabs with a clear error (line/column)
 * - Normalises CRLF to LF before scanning
 * - Handles quoted strings with escape sequences
 */

// AST types are imported by consumers; the tokenizer is self-contained.

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

const HEADER_KEYWORDS = new Set(['from', 'target', 'version', 'compress', 'warning']);
const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Create a token convenience helper. */
function tok(type: TokenType, value: string, line: number, column: number, offset: number): Token {
  return { type, value, line, column, offset };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Tokenize a raw PAKT string into a flat token array.
 *
 * The tokenizer works line-by-line:
 * 1. Normalise CRLF -> LF
 * 2. Reject any tab characters
 * 3. For each line, emit INDENT (if any), then content tokens, then NEWLINE
 * 4. Emit EOF at the end
 *
 * @param input - Raw PAKT text
 * @returns Flat array of tokens
 * @throws {TokenizerError} On illegal characters (e.g. tabs)
 *
 * @example
 * ```ts
 * import { tokenize } from '@sriinnu/pakt';
 * const tokens = tokenize('@from json\nname: Alice');
 * ```
 */
export function tokenize(input: string): Token[] {
  // Normalise line endings
  const text = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const tokens: Token[] = [];
  const lines = text.split('\n');

  /** Running byte offset into the original (normalised) text. */
  let offset = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    const lineNum = lineIdx + 1;

    // -- Reject tabs --------------------------------------------------------
    const tabIdx = line.indexOf('\t');
    if (tabIdx !== -1) {
      throw new TokenizerError(
        'Tab characters are not allowed in PAKT — use spaces for indentation',
        lineNum,
        tabIdx + 1,
      );
    }

    // -- Leading whitespace (INDENT) ----------------------------------------
    let col = 0;
    while (col < line.length && line[col] === ' ') col++;
    if (col > 0) {
      tokens.push(tok('INDENT', String(col), lineNum, 1, offset));
    }

    // -- Scan content -------------------------------------------------------
    while (col < line.length) {
      const ch = line[col]!;

      // Skip whitespace between tokens (not leading — that was INDENT)
      if (ch === ' ') {
        col++;
        continue;
      }

      // Comment: % ...
      if (ch === '%') {
        const commentText = line.slice(col + 1).trimStart();
        tokens.push(tok('COMMENT', commentText, lineNum, col + 1, offset + col));
        col = line.length; // consume rest of line
        continue;
      }

      // @ directive at line start (after optional indent)
      if (ch === '@' && isDirectiveStart(line, col)) {
        const rest = line.slice(col + 1).trimEnd();
        if (rest === 'dict') {
          tokens.push(tok('DICT_START', '@dict', lineNum, col + 1, offset + col));
          col = line.length;
          continue;
        }
        if (rest === 'end') {
          tokens.push(tok('DICT_END', '@end', lineNum, col + 1, offset + col));
          col = line.length;
          continue;
        }
        // Header: @keyword value
        const headerMatch = /^(\w+)\s+(.*)$/.exec(rest);
        if (headerMatch) {
          const keyword = headerMatch[1]!;
          if (HEADER_KEYWORDS.has(keyword)) {
            const val = headerMatch[2]?.trim();
            tokens.push(tok('HEADER', `@${keyword} ${val}`, lineNum, col + 1, offset + col));
            col = line.length;
            continue;
          }
        }
        // Bare @keyword (no value) — still valid header with empty value
        const bareMatch = /^(\w+)$/.exec(rest);
        if (bareMatch && HEADER_KEYWORDS.has(bareMatch[1]!)) {
          tokens.push(tok('HEADER', `@${bareMatch[1]!}`, lineNum, col + 1, offset + col));
          col = line.length;
          continue;
        }
      }

      // Quoted string: "..."
      if (ch === '"') {
        const result = scanQuotedString(line, col, lineNum, offset + col);
        tokens.push(result.token);
        col = result.end;
        continue;
      }

      // Structural single-character tokens
      if (ch === '|') {
        tokens.push(tok('PIPE', '|', lineNum, col + 1, offset + col));
        col++;
        continue;
      }
      if (ch === '[') {
        tokens.push(tok('BRACKET_OPEN', '[', lineNum, col + 1, offset + col));
        col++;
        continue;
      }
      if (ch === ']') {
        tokens.push(tok('BRACKET_CLOSE', ']', lineNum, col + 1, offset + col));
        col++;
        continue;
      }
      if (ch === '{') {
        tokens.push(tok('BRACE_OPEN', '{', lineNum, col + 1, offset + col));
        col++;
        continue;
      }
      if (ch === '}') {
        tokens.push(tok('BRACE_CLOSE', '}', lineNum, col + 1, offset + col));
        col++;
        continue;
      }
      if (ch === ',') {
        tokens.push(tok('COMMA', ',', lineNum, col + 1, offset + col));
        col++;
        continue;
      }

      // Dash — list item prefix: "- " at the start of content
      if (ch === '-' && col + 1 < line.length && line[col + 1] === ' ') {
        tokens.push(tok('DASH', '-', lineNum, col + 1, offset + col));
        col += 2; // skip dash + space
        continue;
      }

      // Colon — key/value separator
      if (ch === ':') {
        tokens.push(tok('COLON', ':', lineNum, col + 1, offset + col));
        col++;
        // If followed by a space, consume the space and scan the value
        if (col < line.length && line[col] === ' ') {
          col++; // skip space after colon

          // If value starts with a quote, delegate to quoted string scanner
          if (col < line.length && line[col] === '"') {
            const result = scanQuotedString(line, col, lineNum, offset + col);
            tokens.push(result.token);
            col = result.end;
            // After the quoted string, check for inline comment
            while (col < line.length && line[col] === ' ') col++;
            if (col < line.length && line[col] === '%') {
              const commentText = line.slice(col + 1).trimStart();
              tokens.push(tok('COMMENT', commentText, lineNum, col + 1, offset + col));
              col = line.length;
            }
          } else {
            const valueStart = col;
            // Scan to end of line (or inline comment)
            const remaining = line.slice(col);
            // Check for inline comment: "%" outside quotes
            const commentIdx = findInlineComment(remaining);
            let valueText: string;
            if (commentIdx >= 0) {
              valueText = remaining.slice(0, commentIdx).trimEnd();
              const commentContent = remaining.slice(commentIdx + 1).trimStart();
              if (valueText.length > 0) {
                tokens.push(tok('VALUE', valueText, lineNum, valueStart + 1, offset + valueStart));
              }
              tokens.push(
                tok(
                  'COMMENT',
                  commentContent,
                  lineNum,
                  valueStart + commentIdx + 1,
                  offset + valueStart + commentIdx,
                ),
              );
              col = line.length;
            } else {
              valueText = remaining.trimEnd();
              if (valueText.length > 0) {
                tokens.push(tok('VALUE', valueText, lineNum, valueStart + 1, offset + valueStart));
              }
              col = line.length;
            }
          }
        }
        continue;
      }

      // Otherwise: scan a word/key token
      const wordResult = scanWord(line, col, lineNum, offset + col);
      tokens.push(wordResult.token);
      col = wordResult.end;
    }

    // -- NEWLINE (except after last line) -----------------------------------
    if (lineIdx < lines.length - 1) {
      tokens.push(tok('NEWLINE', '\n', lineNum, line.length + 1, offset + line.length));
    }

    offset += line.length + 1; // +1 for '\n'
  }

  // -- EOF ----------------------------------------------------------------
  tokens.push(tok('EOF', '', lines.length, 1, offset > 0 ? offset - 1 : 0));
  return tokens;
}

// ---------------------------------------------------------------------------
// Internal scanners
// ---------------------------------------------------------------------------

/** Is `col` pointing at a valid @ directive start? */
function isDirectiveStart(line: string, col: number): boolean {
  // The @ must be the first non-space character on the line
  for (let i = 0; i < col; i++) {
    if (line[i] !== ' ') return false;
  }
  return true;
}

/**
 * Scan a double-quoted string starting at `start`, handling escapes.
 * Returns the token and the index *after* the closing quote.
 */
function scanQuotedString(
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

/** Scan an unquoted word / key starting at `start`. */
function scanWord(
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

/** Characters that terminate a word scan. */
function isDelimiter(ch: string): boolean {
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

/**
 * Find the index of an inline comment in a value string.
 * An inline comment is ` %` (space then percent) outside of quotes.
 * Returns the index of the `%`, or -1 if not found.
 */
function findInlineComment(text: string): number {
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
