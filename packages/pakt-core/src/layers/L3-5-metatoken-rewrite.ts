/**
 * @module layers/L3-5-metatoken-rewrite
 * Body-rewrite helpers for the L3.5 meta-token layer.
 *
 * Extracted to keep {@link module:layers/L3-5-metatoken} under the 400-LOC cap.
 * Provides span-replacement with safe PAKT quoting and the lossless-by-construction
 * roundtrip verification gate.
 *
 * @see layers/L3-5-metatoken.ts (consumer)
 */

// ---------------------------------------------------------------------------
// Constants (duplicated from L3-5-metatoken.ts to avoid circular import)
// ---------------------------------------------------------------------------

/**
 * Matches a PAKT key-value line (possibly indented): `  key: value`.
 * Capture groups: [1] = indent+key+colon-space prefix, [2] = value text.
 * The value may be a double-quoted string (starting with `"`) or a bare token.
 */
const KV_LINE_RE = /^([ \t]*(?:[^:\n\r]+): )(.*\S.*)$/;

// ---------------------------------------------------------------------------
// Quoting helpers
// ---------------------------------------------------------------------------

/**
 * Escape `s` for embedding inside a PAKT `"..."` value (no surrounding quotes).
 * Handles: `\`, `"`, `\n`, `\t`, `\r`.
 *
 * @param s - Raw string to escape.
 * @returns Escaped string safe for PAKT quoted values.
 */
export function escapeForQuotedValue(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
}

// ---------------------------------------------------------------------------
// Body span replacement
// ---------------------------------------------------------------------------

/**
 * Replace `span` with `placeholder` in the body, quoting affected values.
 *
 * The PAKT tokenizer treats `{` as a structural delimiter. Bare unquoted values
 * containing `${b}` (e.g. `AASn${b}`) would be tokenised as `AASn` + BRACE_OPEN
 * + KEY(`b`) + BRACE_CLOSE, corrupting the document. This function is line-aware:
 * - Already-quoted values: replace inside the inner string (no rewrapping needed).
 * - Bare values: if the result contains `${`, wrap the entire value in `"..."`.
 * - Non-key-value lines (tabular, comment): skip conservatively if result has `${`.
 *
 * @param bodyText - PAKT body text (everything after @end)
 * @param span - Literal text span to replace
 * @param placeholder - Replacement string (e.g. `${b}`)
 * @returns Updated body text with properly quoted values
 */
export function replaceSpanInBody(
  bodyText: string,
  span: string,
  placeholder: string,
): string {
  if (!bodyText.includes(span)) return bodyText;

  const outputLines: string[] = [];
  for (const line of bodyText.split('\n')) {
    if (!line.includes(span)) {
      outputLines.push(line);
      continue;
    }

    const kvMatch = KV_LINE_RE.exec(line);
    if (!kvMatch) {
      // Not a key-value line (tabular row, comment, etc.).
      // Conservative: skip lines where we can't safely quote the replacement.
      const replaced = line.split(span).join(placeholder);
      if (replaced.includes('${')) {
        // Unsafe — leave line unchanged to avoid parse corruption.
        outputLines.push(line);
      } else {
        outputLines.push(replaced);
      }
      continue;
    }

    // kvMatch[1] = "  key: " prefix, kvMatch[2] = value text
    const prefix = kvMatch[1] ?? '';
    const valueText = kvMatch[2] ?? '';

    if (valueText.startsWith('"') && valueText.endsWith('"') && valueText.length >= 2) {
      // Already quoted: replace inside the quoted content.
      // The inner text (without surrounding quotes) has PAKT escape sequences.
      const inner = valueText.slice(1, -1); // strip outer quotes
      if (!inner.includes(span)) {
        outputLines.push(line);
        continue;
      }
      const newInner = inner.split(span).join(escapeForQuotedValue(placeholder));
      outputLines.push(`${prefix}"${newInner}"`);
    } else {
      // Bare (unquoted) value: replace and re-quote if the result contains `${`.
      const newValue = valueText.split(span).join(placeholder);
      if (newValue.includes('${')) {
        // Must quote: `${` is invalid in an unquoted PAKT value.
        outputLines.push(`${prefix}"${escapeForQuotedValue(newValue)}"`);
      } else {
        outputLines.push(`${prefix}${newValue}`);
      }
    }
  }

  return outputLines.join('\n');
}

// ---------------------------------------------------------------------------
// Lossless-by-construction gate
// ---------------------------------------------------------------------------

/**
 * Lossless-by-construction gate: expand all `${letter}` placeholders in
 * `rewrittenBody` via `aliasMap` and compare against `originalBody`.
 * Returns `true` iff they match exactly. On `false` the caller abandons the
 * entire rewrite. Overhead: one linear body scan — negligible for < 10 KB.
 *
 * @param rewrittenBody - Body after span→placeholder substitutions
 * @param originalBody - Body before any L3.5 rewrites
 * @param aliasMap - letter → span (e.g. `"b"` → `"_suffix"`)
 */
export function verifyBodyRoundtrip(
  rewrittenBody: string,
  originalBody: string,
  aliasMap: ReadonlyMap<string, string>,
): boolean {
  // Expand all ${letter} placeholders in rewrittenBody using aliasMap
  const expanded = rewrittenBody.replace(/\$\{([a-z]{1,2})\}/g, (_match, name: string) => {
    const exp = aliasMap.get(name);
    return exp !== undefined ? exp : _match;
  });
  return expanded === originalBody;
}
