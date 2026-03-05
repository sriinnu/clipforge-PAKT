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
 *
 * Token type definitions, error class, and individual scanner functions
 * live in {@link module:parser/token-matchers}.
 */

import {
  HEADER_KEYWORDS,
  TokenizerError,
  findInlineComment,
  isDirectiveStart,
  scanQuotedString,
  scanWord,
  tok,
} from './token-matchers.js';
import type { Token } from './token-matchers.js';

// ---------------------------------------------------------------------------
// Re-exports — preserve the original public surface of this module
// ---------------------------------------------------------------------------

/** @see {@link module:parser/token-matchers} */
export { TokenizerError } from './token-matchers.js';
export type { Token, TokenType } from './token-matchers.js';

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
    scanLineContent(line, col, lineNum, offset, tokens);

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
// Line content scanner
// ---------------------------------------------------------------------------

/**
 * Scan all content tokens within a single line, starting after any indent.
 * Mutates the `tokens` array by pushing discovered tokens.
 * @param line - The full source line
 * @param startCol - Column to start scanning from (after indent)
 * @param lineNum - 1-based line number
 * @param lineOffset - Byte offset of the start of this line
 * @param tokens - Token accumulator (mutated in place)
 */
function scanLineContent(
  line: string,
  startCol: number,
  lineNum: number,
  lineOffset: number,
  tokens: Token[],
): void {
  let col = startCol;

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
      tokens.push(tok('COMMENT', commentText, lineNum, col + 1, lineOffset + col));
      return; // consume rest of line
    }

    // @ directive at line start (after optional indent)
    if (ch === '@' && isDirectiveStart(line, col)) {
      const consumed = scanDirective(line, col, lineNum, lineOffset, tokens);
      if (consumed) return;
    }

    // Quoted string: "..."
    if (ch === '"') {
      const result = scanQuotedString(line, col, lineNum, lineOffset + col);
      tokens.push(result.token);
      col = result.end;
      continue;
    }

    // Structural single-character tokens
    if (ch === '|') {
      tokens.push(tok('PIPE', '|', lineNum, col + 1, lineOffset + col));
      col++;
      continue;
    }
    if (ch === '[') {
      tokens.push(tok('BRACKET_OPEN', '[', lineNum, col + 1, lineOffset + col));
      col++;
      continue;
    }
    if (ch === ']') {
      tokens.push(tok('BRACKET_CLOSE', ']', lineNum, col + 1, lineOffset + col));
      col++;
      continue;
    }
    if (ch === '{') {
      tokens.push(tok('BRACE_OPEN', '{', lineNum, col + 1, lineOffset + col));
      col++;
      continue;
    }
    if (ch === '}') {
      tokens.push(tok('BRACE_CLOSE', '}', lineNum, col + 1, lineOffset + col));
      col++;
      continue;
    }
    if (ch === ',') {
      tokens.push(tok('COMMA', ',', lineNum, col + 1, lineOffset + col));
      col++;
      continue;
    }

    // Dash — list item prefix: "- " at the start of content
    if (ch === '-' && col + 1 < line.length && line[col + 1] === ' ') {
      tokens.push(tok('DASH', '-', lineNum, col + 1, lineOffset + col));
      col += 2; // skip dash + space
      continue;
    }

    // Colon — key/value separator
    if (ch === ':') {
      col = scanColon(line, col, lineNum, lineOffset, tokens);
      continue;
    }

    // Otherwise: scan a word/key token
    const wordResult = scanWord(line, col, lineNum, lineOffset + col);
    tokens.push(wordResult.token);
    col = wordResult.end;
  }
}

// ---------------------------------------------------------------------------
// Directive scanner
// ---------------------------------------------------------------------------

/**
 * Try to scan an @ directive (dict/end/header). Returns true if consumed.
 * @param line - The full source line
 * @param col - Column of the @ character
 * @param lineNum - 1-based line number
 * @param lineOffset - Byte offset of the start of this line
 * @param tokens - Token accumulator (mutated in place)
 * @returns True if the rest of the line was consumed as a directive
 */
function scanDirective(
  line: string,
  col: number,
  lineNum: number,
  lineOffset: number,
  tokens: Token[],
): boolean {
  const rest = line.slice(col + 1).trimEnd();

  if (rest === 'dict') {
    tokens.push(tok('DICT_START', '@dict', lineNum, col + 1, lineOffset + col));
    return true;
  }
  if (rest === 'end') {
    tokens.push(tok('DICT_END', '@end', lineNum, col + 1, lineOffset + col));
    return true;
  }

  // Header: @keyword value
  const headerMatch = /^(\w+)\s+(.*)$/.exec(rest);
  if (headerMatch) {
    const keyword = headerMatch[1]!;
    if (HEADER_KEYWORDS.has(keyword)) {
      const val = headerMatch[2]?.trim();
      tokens.push(tok('HEADER', `@${keyword} ${val}`, lineNum, col + 1, lineOffset + col));
      return true;
    }
  }

  // Bare @keyword (no value) — still valid header with empty value
  const bareMatch = /^(\w+)$/.exec(rest);
  if (bareMatch && HEADER_KEYWORDS.has(bareMatch[1]!)) {
    tokens.push(tok('HEADER', `@${bareMatch[1]!}`, lineNum, col + 1, lineOffset + col));
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Colon scanner
// ---------------------------------------------------------------------------

/**
 * Scan a colon token and the optional value/comment that follows.
 * @param line - The full source line
 * @param col - Column of the ':' character
 * @param lineNum - 1-based line number
 * @param lineOffset - Byte offset of the start of this line
 * @param tokens - Token accumulator (mutated in place)
 * @returns New column position after scanning
 */
function scanColon(
  line: string,
  startCol: number,
  lineNum: number,
  lineOffset: number,
  tokens: Token[],
): number {
  let col = startCol;
  tokens.push(tok('COLON', ':', lineNum, col + 1, lineOffset + col));
  col++;

  // If followed by a space, consume the space and scan the value
  if (col < line.length && line[col] === ' ') {
    col++; // skip space after colon

    // If value starts with a quote, delegate to quoted string scanner
    if (col < line.length && line[col] === '"') {
      const result = scanQuotedString(line, col, lineNum, lineOffset + col);
      tokens.push(result.token);
      col = result.end;
      // After the quoted string, check for inline comment
      while (col < line.length && line[col] === ' ') col++;
      if (col < line.length && line[col] === '%') {
        const commentText = line.slice(col + 1).trimStart();
        tokens.push(tok('COMMENT', commentText, lineNum, col + 1, lineOffset + col));
        col = line.length;
      }
    } else {
      const valueStart = col;
      // Scan to end of line (or inline comment)
      const remaining = line.slice(col);
      const commentIdx = findInlineComment(remaining);
      if (commentIdx >= 0) {
        const valueText = remaining.slice(0, commentIdx).trimEnd();
        const commentContent = remaining.slice(commentIdx + 1).trimStart();
        if (valueText.length > 0) {
          tokens.push(tok('VALUE', valueText, lineNum, valueStart + 1, lineOffset + valueStart));
        }
        tokens.push(
          tok(
            'COMMENT',
            commentContent,
            lineNum,
            valueStart + commentIdx + 1,
            lineOffset + valueStart + commentIdx,
          ),
        );
        col = line.length;
      } else {
        const valueText = remaining.trimEnd();
        if (valueText.length > 0) {
          tokens.push(tok('VALUE', valueText, lineNum, valueStart + 1, lineOffset + valueStart));
        }
        col = line.length;
      }
    }
  }

  return col;
}
