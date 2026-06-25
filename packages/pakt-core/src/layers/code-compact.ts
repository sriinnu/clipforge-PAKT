/**
 * @module layers/code-compact
 * Deterministic, literal-aware code compaction for tool-output source code.
 *
 * Agent tool results are dominated by code and logs (ACBench, 2505.19433), and
 * comments + blank-line padding are pure token cost when the code is being read
 * for structure or behavior. This layer strips them **without a full AST** but
 * **with a real lexer**: it scans character-by-character tracking string,
 * char, template, and comment state, so a comment marker inside a string
 * literal (`"http://x"`, `re.compile("# not a comment")`) is never mistaken for
 * a comment. String/template/triple-quoted contents are emitted verbatim.
 *
 * Behavior-preserving but not byte-lossless: comments and redundant blank lines
 * are removed. It is therefore opt-in (like the extractive layer) rather than
 * part of the lossless L1–L3 core. What it removes — comments and blank-line
 * padding — never changes program semantics in any supported language.
 *
 * Supported families:
 *   - `c-family`: `//` line, `/​* *​/` block comments; `"`, `'`, `` ` `` literals.
 *     Covers JS/TS/JSON5/Java/C/C++/Go/Rust/Swift/Kotlin.
 *   - `python`:   `#` line comments; `'`/`"` and `'''`/`"""` literals.
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

/**
 * Scan `source`, dropping comments and emitting string/template/triple-quoted
 * literals verbatim. Returns lines tagged with whether they sit inside a
 * multi-line literal (so blank-line collapsing can skip protected regions).
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a character-level lexer is inherently a single dense state machine
function scan(source: string, family: CodeFamily): ScannedLine[] {
  const lines: ScannedLine[] = [];
  let cur = '';
  // Are we currently inside a literal that may span newlines?
  let inMultiline = false;

  const pushChar = (ch: string) => {
    if (ch === '\n') {
      lines.push({ text: cur, protectedLine: inMultiline });
      cur = '';
    } else {
      cur += ch;
    }
  };
  const pushStr = (s: string) => {
    for (const ch of s) pushChar(ch);
  };

  const n = source.length;
  let i = 0;
  while (i < n) {
    const ch = source[i] as string;
    const two = source.slice(i, i + 2);
    const three = source.slice(i, i + 3);

    // -- Comments --
    if (family === 'c-family' && two === '//') {
      while (i < n && source[i] !== '\n') i++; // drop to EOL (newline emitted next loop)
      continue;
    }
    if (family === 'c-family' && two === '/*') {
      i += 2;
      while (i < n && source.slice(i, i + 2) !== '*/') i++;
      i += 2; // consume closing */
      continue;
    }
    if (family === 'python' && ch === '#') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }

    // -- Triple-quoted strings (python) — emitted verbatim --
    if (family === 'python' && (three === '"""' || three === "'''")) {
      const quote = three;
      pushStr(quote);
      i += 3;
      inMultiline = true;
      while (i < n && source.slice(i, i + 3) !== quote) {
        pushChar(source[i] as string);
        i++;
      }
      pushStr(source.slice(i, i + 3));
      i += 3;
      inMultiline = false;
      continue;
    }

    // -- Single/double-quoted and template strings — emitted verbatim --
    const isStringQuote = ch === '"' || ch === "'" || (family === 'c-family' && ch === '`');
    if (isStringQuote) {
      const quote = ch;
      const multiline = quote === '`';
      pushChar(ch);
      i++;
      if (multiline) inMultiline = true;
      while (i < n) {
        const c = source[i] as string;
        if (c === '\\') {
          pushStr(source.slice(i, i + 2)); // keep escape pair verbatim
          i += 2;
          continue;
        }
        if (c === quote) {
          pushChar(c);
          i++;
          break;
        }
        // A non-template quoted string ends at an unescaped newline (defensive).
        if (!multiline && c === '\n') break;
        pushChar(c);
        i++;
      }
      if (multiline) inMultiline = false;
      continue;
    }

    // -- Ordinary character --
    pushChar(ch);
    i++;
  }
  lines.push({ text: cur, protectedLine: inMultiline });
  return lines;
}

/**
 * Compact source code by removing comments and collapsing redundant blank
 * lines, with full string/template/triple-quote awareness.
 *
 * Returns the original text unchanged when compaction yields no net token
 * reduction (e.g. comment-free code), so it is always safe to apply.
 *
 * @param source - The source code to compact.
 * @param opts - {@link CompactCodeOptions}.
 * @returns {@link CompactCodeResult}
 */
export function compactCode(source: string, opts: CompactCodeOptions = {}): CompactCodeResult {
  const model = opts.model ?? 'gpt-4o';
  const lang = !opts.lang || opts.lang === 'auto' ? detectCodeFamily(source) : opts.lang;

  const scanned = scan(source, lang);

  // Collapse runs of blank lines, but never across protected (multi-line
  // literal) regions — a blank line inside a template/triple-quote is content.
  const out: string[] = [];
  let prevBlank = false;
  for (const line of scanned) {
    const isBlank = !line.protectedLine && line.text.trim() === '';
    if (isBlank && prevBlank) continue; // drop the extra blank
    out.push(line.protectedLine ? line.text : line.text.replace(/\s+$/, ''));
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
