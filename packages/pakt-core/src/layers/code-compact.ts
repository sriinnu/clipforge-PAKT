/**
 * @module layers/code-compact
 * Deterministic, literal-aware code compaction for tool-output source code.
 *
 * Agent tool results are dominated by code and logs (ACBench, 2505.19433), and
 * comments + blank-line padding are pure token cost when the code is being read
 * for structure or behavior. This layer strips them **without a full AST** but
 * **with a real lexer**: it scans character-by-character tracking string, char,
 * template, regex, and comment state.
 *
 * ### Safety model
 * The only constructs ever *deleted* are line and block comments (c-family)
 * and `#` comments (python), and those markers are recognized **only in true code
 * position** — never inside a string, template, triple-quoted string, or regex
 * literal, all of which are emitted verbatim. The c-family scanner distinguishes
 * a regex literal from division by expression context, but even a misclassified
 * `/` is emitted verbatim (it is never a deletion), so the worst case is
 * *under*-compaction, never corruption. If a comment / string / template is left
 * unterminated at EOF (e.g. a payload truncated mid-construct), the whole pass
 * is abandoned and the input is returned unchanged. Behavior-preserving by
 * construction; net-savings gated so it is always safe to apply.
 *
 * Not byte-lossless (comments and redundant blank lines are removed), so it is
 * opt-in rather than part of the lossless L1–L3 core.
 *
 * Supported families:
 *   - `c-family`: line and block comments; `"`, `'`, `` ` ``
 *     (template) string literals; `/…/` regex literals. Covers JS/TS/JSON5/
 *     Java/C/C++/Go/Kotlin/Swift. Languages that use `'` for char literals or
 *     lifetimes (C, Rust) are handled conservatively — a `'…'` span only ever
 *     inhibits stripping on its line, never corrupts.
 *   - `python`: `#` line comments; `'`/`"` and `'''`/`"""` string literals.
 *     Covers Python/Ruby/shell/YAML-ish `#` comment styles.
 */

import { countTokens } from '../tokens/index.js';

/** Language family for {@link compactCode}. */
export type CodeFamily = 'c-family' | 'python';

/** Options for {@link compactCode}. */
export interface CompactCodeOptions {
  /** Language family, or `'auto'` to detect heuristically. @default 'auto' */
  lang?: CodeFamily | 'auto';
  /** Model identifier for token counting. @default 'gpt-4o' */
  model?: string;
}

/** Result of {@link compactCode}. */
export interface CompactCodeResult {
  /** Compacted source, or the original when no net token savings were found. */
  text: string;
  /** The language family used. */
  lang: CodeFamily;
  /** Net tokens saved (>= 0; 0 means the original was returned). */
  savedTokens: number;
}

/**
 * Heuristically classify a source string as Python-family or C-family.
 *
 * Leans C-family by default (the broader net). Picks Python when Python-only
 * cues (`def`/`elif`/`#`-comment lines) clearly outweigh C-family cues
 * (braces, semicolon line-endings, `//` comments).
 */
export function detectCodeFamily(source: string): CodeFamily {
  const pyCues =
    (source.match(/^\s*(def|class|elif|import|from)\s/gm)?.length ?? 0) +
    (source.match(/:\s*$/gm)?.length ?? 0) +
    (source.match(/^\s*#/gm)?.length ?? 0);
  const cCues =
    (source.match(/[{};]\s*$/gm)?.length ?? 0) +
    (source.match(/\/\//g)?.length ?? 0) +
    (source.match(/\/\*/g)?.length ?? 0);
  return pyCues > cCues ? 'python' : 'c-family';
}

/**
 * Conservative "is this source code?" gate for safe auto-application.
 *
 * Deliberately strict: requires BOTH a language keyword/operator cue AND a
 * structural cue (braces, semicolon line-ends, or block-colon lines), over
 * multiple lines. This rejects prose and — critically — Markdown, whose `#`
 * headings would otherwise be mistaken for Python comments. Callers applying
 * {@link compactCode} to untyped text should gate on this first.
 */
export function looksLikeCode(source: string): boolean {
  if (source.split('\n').length < 3) return false;
  const keywordCue =
    /\b(function|def|class|import|export|return|const|let|var|public|private|func|fn|package|#include)\b/.test(
      source,
    ) || /=>/.test(source);
  const structuralCue =
    (source.match(/[{}]/g)?.length ?? 0) >= 2 ||
    (source.match(/;\s*$/gm)?.length ?? 0) >= 2 ||
    (source.match(/^\s*(def|class|if|for|while|with|try|else|elif)\b.*:\s*$/gm)?.length ?? 0) >= 1;
  return keywordCue && structuralCue;
}

/** One output line plus whether its terminating newline fell inside a multi-line literal. */
interface ScannedLine {
  text: string;
  /** True when this line lives inside a template / triple-quoted string. */
  protectedLine: boolean;
}

/** A scan result: emitted lines plus whether every construct was terminated. */
interface ScanResult {
  lines: ScannedLine[];
  /** False when a comment/string/template was left open at EOF — caller must no-op. */
  complete: boolean;
}

/** Keywords after which a `/` begins a regex literal rather than division. */
const REGEX_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'do',
  'else',
  'yield',
  'await',
  'case',
  'void',
  'delete',
  'new',
  'throw',
]);

/** Identifier characters (JS/TS/most c-family). */
function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

/**
 * C-family scanner with string, template (+ `${}` interpolation), regex, and
 * comment awareness. Only line and block comments in code position are dropped;
 * everything else is emitted verbatim. Returns `complete: false` if a comment,
 * string, or template is unterminated at EOF.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a character-level lexer is one dense, cohesive state machine
function scanCFamily(source: string): ScanResult {
  const lines: ScannedLine[] = [];
  let cur = '';
  let templateDepth = 0; // number of open template literals (for protectedLine)
  let complete = true;

  const emit = (ch: string) => {
    if (ch === '\n') {
      lines.push({ text: cur, protectedLine: templateDepth > 0 });
      cur = '';
    } else {
      cur += ch;
    }
  };
  const emitStr = (s: string) => {
    for (const ch of s) emit(ch);
  };

  // Stack of frames: a 'code' frame may be an interpolation (closed by `}`);
  // a 'template' frame is verbatim until its closing backtick.
  const stack: Array<{ kind: 'code' | 'template'; interp: boolean }> = [
    { kind: 'code', interp: false },
  ];
  // Regex-vs-division: a `/` starts a regex unless the previous token was a
  // value (identifier/number/`)`/`]`/string/regex). Keywords like `return`
  // reset this to allow a following regex.
  let lastWasValue = false;
  let word = '';
  const flushWord = () => {
    if (word) {
      lastWasValue = !REGEX_KEYWORDS.has(word);
      word = '';
    }
  };

  const n = source.length;
  let i = 0;
  while (i < n) {
    const top = stack[stack.length - 1];
    const ch = source[i] as string;

    // -- Inside a template literal: verbatim until `${` or closing backtick --
    if (top?.kind === 'template') {
      if (ch === '\\') {
        emitStr(source.slice(i, i + 2));
        i += 2;
        continue;
      }
      if (ch === '`') {
        emit(ch);
        stack.pop();
        templateDepth--;
        lastWasValue = true;
        i++;
        continue;
      }
      if (source.slice(i, i + 2) === '${') {
        emitStr('${');
        stack.push({ kind: 'code', interp: true });
        lastWasValue = false;
        word = '';
        i += 2;
        continue;
      }
      emit(ch);
      i++;
      continue;
    }

    // -- Code frame --
    if (isWordChar(ch)) {
      word += ch;
      emit(ch);
      i++;
      continue;
    }
    flushWord();

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      emit(ch); // whitespace does not change value/operator context
      i++;
      continue;
    }

    // Single/double-quoted string — verbatim, single line.
    if (ch === '"' || ch === "'") {
      const quote = ch;
      emit(ch);
      i++;
      while (i < n) {
        const c = source[i] as string;
        if (c === '\\') {
          emitStr(source.slice(i, i + 2));
          i += 2;
          continue;
        }
        if (c === quote) {
          emit(c);
          i++;
          break;
        }
        if (c === '\n') break; // unterminated single-line string (defensive)
        emit(c);
        i++;
      }
      lastWasValue = true;
      continue;
    }

    // Template literal start.
    if (ch === '`') {
      emit(ch);
      stack.push({ kind: 'template', interp: false });
      templateDepth++;
      i++;
      continue;
    }

    // Interpolation close.
    if (ch === '}' && top?.interp) {
      emit(ch);
      stack.pop();
      lastWasValue = true;
      i++;
      continue;
    }

    if (ch === '/') {
      const two = source.slice(i, i + 2);
      // `//` and `/*` are unambiguously comments in code position.
      if (two === '//') {
        while (i < n && source[i] !== '\n') i++;
        continue;
      }
      if (two === '/*') {
        i += 2;
        while (i < n && source.slice(i, i + 2) !== '*/') i++;
        if (i >= n) {
          complete = false; // unterminated block comment → caller no-ops
          break;
        }
        i += 2;
        continue;
      }
      // Single `/`: regex literal (verbatim) when a value is NOT expected here.
      if (!lastWasValue) {
        let j = i + 1;
        let inClass = false;
        let found = false;
        while (j < n) {
          const c = source[j] as string;
          if (c === '\\') {
            j += 2;
            continue;
          }
          if (c === '\n') break; // regex cannot span a newline → it was division
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) {
            found = true;
            break;
          }
          j++;
        }
        if (found) {
          let k = j + 1;
          while (k < n && /[a-z]/i.test(source[k] as string)) k++; // regex flags
          emitStr(source.slice(i, k));
          i = k;
          lastWasValue = true;
          continue;
        }
      }
      // Division.
      emit('/');
      lastWasValue = false;
      i++;
      continue;
    }

    // Other punctuation/operators. `)`/`]` complete a value; everything else
    // expects an expression next (so a following `/` is a regex).
    emit(ch);
    lastWasValue = ch === ')' || ch === ']';
    i++;
  }

  // Any frame other than the base code frame left open ⇒ unterminated template.
  if (stack.length > 1) complete = false;
  lines.push({ text: cur, protectedLine: templateDepth > 0 });
  return { lines, complete };
}

/**
 * Python-family scanner: drops `#` comments, emits `'…'`/`"…"` and
 * `'''…'''`/`"""…"""` strings verbatim. Returns `complete: false` if a
 * triple-quoted string is unterminated at EOF.
 */
function scanPython(source: string): ScanResult {
  const lines: ScannedLine[] = [];
  let cur = '';
  let inMultiline = false;
  let complete = true;

  const emit = (ch: string) => {
    if (ch === '\n') {
      lines.push({ text: cur, protectedLine: inMultiline });
      cur = '';
    } else {
      cur += ch;
    }
  };
  const emitStr = (s: string) => {
    for (const ch of s) emit(ch);
  };

  const n = source.length;
  let i = 0;
  while (i < n) {
    const ch = source[i] as string;
    const three = source.slice(i, i + 3);

    if (ch === '#') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }

    if (three === '"""' || three === "'''") {
      emitStr(three);
      i += 3;
      inMultiline = true;
      while (i < n && source.slice(i, i + 3) !== three) {
        emit(source[i] as string);
        i++;
      }
      if (i >= n) {
        complete = false; // unterminated triple-quoted string → caller no-ops
        break;
      }
      emitStr(source.slice(i, i + 3));
      i += 3;
      inMultiline = false;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      emit(ch);
      i++;
      while (i < n) {
        const c = source[i] as string;
        if (c === '\\') {
          emitStr(source.slice(i, i + 2));
          i += 2;
          continue;
        }
        if (c === quote) {
          emit(c);
          i++;
          break;
        }
        if (c === '\n') break;
        emit(c);
        i++;
      }
      continue;
    }

    emit(ch);
    i++;
  }

  lines.push({ text: cur, protectedLine: inMultiline });
  return { lines, complete };
}

/**
 * Compact source code by removing comments and collapsing redundant blank
 * lines, with full string/template/regex awareness (see the module safety
 * model). Returns the original text unchanged when compaction yields no net
 * token reduction, or when a construct was left unterminated.
 *
 * @param source - The source code to compact.
 * @param opts - {@link CompactCodeOptions}.
 * @returns {@link CompactCodeResult}
 */
export function compactCode(source: string, opts: CompactCodeOptions = {}): CompactCodeResult {
  const model = opts.model ?? 'gpt-4o';
  const lang = !opts.lang || opts.lang === 'auto' ? detectCodeFamily(source) : opts.lang;

  const { lines: scanned, complete } = lang === 'python' ? scanPython(source) : scanCFamily(source);
  // Unterminated comment/string/template ⇒ result would not be behavior-
  // preserving. Return the input unchanged rather than risk dropping code.
  if (!complete) return { text: source, lang, savedTokens: 0 };

  // Collapse runs of blank lines, but never across protected (multi-line
  // literal) regions — a blank line inside a template/triple-quote is content.
  const out: string[] = [];
  let prevBlank = false;
  for (const line of scanned) {
    const isBlank = !line.protectedLine && line.text.trim() === '';
    if (isBlank && prevBlank) continue; // drop the extra blank
    // Strip only spaces/tabs (not `\r`) so CRLF line endings survive.
    out.push(line.protectedLine ? line.text : line.text.replace(/[ \t]+$/, ''));
    prevBlank = isBlank;
  }
  // Trim a leading/trailing blank line for tidiness (safe, non-semantic).
  while (out.length > 1 && out[0]?.trim() === '') out.shift();
  while (out.length > 1 && out[out.length - 1]?.trim() === '') out.pop();

  const text = out.join('\n');
  const savedTokens = countTokens(source, model) - countTokens(text, model);
  if (savedTokens <= 0) return { text: source, lang, savedTokens: 0 };

  return { text, lang, savedTokens };
}
