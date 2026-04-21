/**
 * @module layers/L4-pii
 * L4 PII strategy — flag and/or redact personally-identifiable
 * information in a serialized PAKT string.
 *
 * Two modes:
 *
 * - **`flag`**  — detect only. Emit an `@warning pii` header documenting
 *   the per-kind counts. The document body is unchanged, so the
 *   operation is reversible from PAKT's point of view.
 * - **`redact`** — detect and substitute. Replace each match with a
 *   placeholder like `[EMAIL]` / `[IP]`. This is lossy; the caller must
 *   explicitly opt in.
 *
 * Both modes prepend/merge header lines into the PAKT string directly
 * rather than re-parsing the AST. This keeps the layer cheap (one
 * string scan) and immune to changes in the serializer's formatting.
 *
 * @see {@link ../pii/detector.ts}
 * @see {@link ../pii/redact.ts}
 */

import { type PIIKind, type PIIMatch, detectPII } from '../pii/detector.js';
import { redactPII } from '../pii/redact.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Behaviour of the L4 PII strategy.
 *
 * - `off`    — PII handling disabled; the layer is a no-op. Default.
 * - `flag`   — detect and annotate via `@warning pii` header only.
 * - `redact` — detect, annotate, AND substitute placeholders. Lossy.
 */
export type PIIMode = 'off' | 'flag' | 'redact';

/**
 * Options for {@link applyPIILayer}.
 */
export interface L4PIIOptions {
  /** Behaviour — default `'off'`. */
  mode?: PIIMode;
  /** Restrict detection to this subset of kinds. */
  kinds?: readonly PIIKind[];
  /**
   * When true, return the reversal mapping alongside the redacted text
   * so callers can store it locally and restore originals later.
   * Ignored unless `mode === 'redact'`. Default: `false`.
   */
  reversible?: boolean;
}

/**
 * Result of {@link applyPIILayer}.
 */
export interface L4PIIResult {
  /** Transformed PAKT string. */
  text: string;
  /** True when any PII was detected (and so a header or redaction was applied). */
  applied: boolean;
  /**
   * True when the strategy actually mutated scanned values (redact mode
   * only). `flag` mode never sets this.
   */
  lossy: boolean;
  /** Raw match list from the detector. */
  matches: PIIMatch[];
  /** Count of detections per kind. */
  counts: Partial<Record<PIIKind, number>>;
  /**
   * Placeholder -> original mapping. Only populated in redact mode when
   * `options.reversible === true`.
   */
  mapping?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Header formatting
// ---------------------------------------------------------------------------

/**
 * Serialize per-kind counts into a compact warning payload suitable for
 * an `@warning pii` header, e.g. `pii email=2,jwt=1`.
 *
 * Sorted by kind name so the header is stable across runs and diffs
 * cleanly in snapshot tests.
 */
function formatPIIWarningValue(counts: Partial<Record<PIIKind, number>>): string {
  const parts = Object.entries(counts)
    .filter((entry): entry is [PIIKind, number] => entry[1] !== undefined && entry[1] > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${kind}=${count}`);
  return parts.length === 0 ? 'pii' : `pii ${parts.join(',')}`;
}

/**
 * Inject an `@warning pii …` header into a PAKT string, placing it at
 * the top of the header block (after any existing `@version` /
 * `@from`), before the body. If a `@warning pii` header already exists
 * it is replaced in place.
 *
 * Keeps the algorithm purely string-level so we don't depend on the
 * parser round-trip being cheap.
 *
 * @param pakt       - Serialized PAKT
 * @param headerLine - The new `@warning pii …` line (no trailing newline)
 * @returns PAKT with the header inserted or replaced
 */
function injectWarningHeader(pakt: string, headerLine: string): string {
  const lines = pakt.split('\n');
  /* Find any existing `@warning pii` line and replace it in place. */
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (/^@warning\s+pii(\s|$)/.test(line)) {
      lines[i] = headerLine;
      return lines.join('\n');
    }
  }

  /* No existing header — insert after the last `@…` header line so it
     groups with siblings, or at position 0 if there are none. */
  let insertAt = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && /^@\w+/.test(line)) insertAt = i + 1;
    else if (line !== undefined && line.trim().length > 0) break;
  }
  lines.splice(insertAt, 0, headerLine);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply the L4 PII strategy to a serialized PAKT string.
 *
 * In `flag` mode this is a pure scan + header annotation; in `redact`
 * mode it substitutes placeholders in addition.
 *
 * Returns the original string unchanged when:
 *   - mode is `'off'` (the default), or
 *   - no PII was detected.
 *
 * @param text    - Serialized PAKT input
 * @param options - Mode + optional kind filter
 * @returns See {@link L4PIIResult}
 *
 * @example
 * Flag-only scan:
 * ```ts
 * const { text, counts, applied } = applyPIILayer(pakt, { mode: 'flag' });
 * if (applied) console.warn('PII detected:', counts);
 * ```
 *
 * @example
 * Redact (lossy):
 * ```ts
 * const { text, mapping } = applyPIILayer(pakt, {
 *   mode: 'redact',
 *   reversible: true,
 * });
 * // send `text` to the LLM; keep `mapping` locally.
 * ```
 */
export function applyPIILayer(text: string, options?: L4PIIOptions): L4PIIResult {
  const mode: PIIMode = options?.mode ?? 'off';
  if (mode === 'off' || !text) {
    return { text, applied: false, lossy: false, matches: [], counts: {} };
  }

  if (mode === 'flag') {
    const matches = detectPII(text, { kinds: options?.kinds });
    if (matches.length === 0) {
      return { text, applied: false, lossy: false, matches: [], counts: {} };
    }
    const counts = countByKind(matches);
    const header = `@warning ${formatPIIWarningValue(counts)}`;
    return {
      text: injectWarningHeader(text, header),
      applied: true,
      lossy: false,
      matches,
      counts,
    };
  }

  /* mode === 'redact' */
  const redacted = redactPII(text, {
    kinds: options?.kinds,
    reversible: options?.reversible === true,
  });
  if (redacted.redactions.length === 0) {
    return { text, applied: false, lossy: false, matches: [], counts: {} };
  }
  const header = `@warning ${formatPIIWarningValue(redacted.counts)}`;
  const annotated = injectWarningHeader(redacted.text, header);
  const result: L4PIIResult = {
    text: annotated,
    applied: true,
    lossy: true,
    matches: redacted.redactions,
    counts: redacted.counts,
  };
  if (redacted.mapping) result.mapping = redacted.mapping;
  return result;
}

/**
 * Count a match list into a per-kind tally.
 */
function countByKind(matches: PIIMatch[]): Partial<Record<PIIKind, number>> {
  const counts: Partial<Record<PIIKind, number>> = {};
  for (const m of matches) {
    counts[m.kind] = (counts[m.kind] ?? 0) + 1;
  }
  return counts;
}
