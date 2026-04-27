/**
 * @module pii/redact
 * PII redaction — replace detected PII in a string with stable
 * placeholders.
 *
 * The redactor is intentionally simple:
 *
 * 1. Call {@link detectPII} to get non-overlapping matches.
 * 2. Walk the string once, substituting each match with a placeholder
 *    chosen by the caller (or a sensible default per kind).
 * 3. Return the redacted string plus the per-kind counts and the raw
 *    match list so callers can reconstruct mappings if they want
 *    reversible redaction.
 *
 * Reversibility is an opt-in concern: if the caller supplies the
 * `reversible: true` option we also emit a `mapping` dictionary keyed
 * by placeholder so they can persist it locally and restore the
 * originals later. The PAKT output itself never carries the mapping.
 *
 * @see {@link ./detector.ts}
 */

import { type PIIKind, type PIIMatch, detectPII } from './detector.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Options for {@link redactPII}.
 */
export interface RedactPIIOptions {
  /** Restrict detection to this subset of kinds. */
  kinds?: readonly PIIKind[];
  /**
   * Build a placeholder for a given kind + 1-based occurrence index.
   * Default uses a flat bracketed label: `[EMAIL]`, `[IP]`, `[TOKEN]`.
   *
   * Return a stable string; the redactor uses the same placeholder for
   * every occurrence of the same underlying value.
   */
  placeholderFor?: (kind: PIIKind, occurrence: number) => string;
  /**
   * When true, return a `mapping` from placeholder back to the original
   * matched value so callers can store it locally and restore later.
   * Default: `false`.
   */
  reversible?: boolean;
}

/**
 * Result of {@link redactPII}.
 */
export interface RedactPIIResult {
  /** Redacted string. */
  text: string;
  /** Match list (pre-redaction offsets). */
  redactions: PIIMatch[];
  /** Count of redactions per kind. */
  counts: Partial<Record<PIIKind, number>>;
  /**
   * Placeholder-to-original mapping. Populated only when
   * `options.reversible` is true. Intended to be stored **locally**
   * by the caller — not shipped to the LLM.
   */
  mapping?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Placeholder defaults
// ---------------------------------------------------------------------------

const DEFAULT_LABELS: Record<PIIKind, string> = {
  email: 'EMAIL',
  phone: 'PHONE',
  ipv4: 'IP',
  ipv6: 'IP6',
  jwt: 'TOKEN',
  'aws-access-key': 'AWS_KEY',
  'aws-secret-key': 'AWS_SECRET',
  'credit-card': 'CARD',
  ssn: 'SSN',
};

/**
 * Default placeholder shape: `[KIND]` for flat output. Callers who want
 * distinguishable occurrences (e.g. for reversible mode) should supply
 * a `placeholderFor` that incorporates the occurrence index.
 */
function defaultPlaceholder(kind: PIIKind): string {
  return `[${DEFAULT_LABELS[kind]}]`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect and redact PII in `text`. Non-overlapping matches are replaced
 * with placeholders in a single left-to-right pass, preserving the
 * surrounding text exactly.
 *
 * Repeated occurrences of the same underlying value share the same
 * placeholder — useful when the same email / key appears many times in
 * a payload.
 *
 * @param text - Input string to redact
 * @param options - Optional detector + placeholder configuration
 * @returns Redacted text plus per-kind counts and optional mapping
 *
 * @example
 * ```ts
 * import { redactPII } from '@sriinnu/pakt';
 *
 * const { text, counts } = redactPII(
 *   'Contact alice@example.com (and alice@example.com again)',
 * );
 * // text   = 'Contact [EMAIL] (and [EMAIL] again)'
 * // counts = { email: 2 }
 * ```
 *
 * @example
 * Reversible redaction — caller stores the mapping locally.
 * ```ts
 * const { text, mapping } = redactPII('token: eyJhbGciOi...sig', {
 *   reversible: true,
 *   placeholderFor: (kind, i) => `[${kind.toUpperCase()}_${i}]`,
 * });
 * // text    = 'token: [JWT_1]'
 * // mapping = { '[JWT_1]': 'eyJhbGciOi...sig' }
 * ```
 */
/**
 * Per-pass placeholder bookkeeping. Centralised so {@link redactPII}
 * stays a flat slice/join loop without nested branching.
 */
interface PlaceholderState {
  /** Stable map: identical PII values always reuse the same placeholder. */
  valueToPlaceholder: Map<string, string>;
  /** Per-kind occurrence counter used to build sequential placeholders. */
  occurrenceByKind: Map<PIIKind, number>;
  /** Reverse mapping populated when `options.reversible === true`. */
  mapping: Record<string, string>;
  /** Optional caller-supplied placeholder formatter. */
  placeholderFor: RedactPIIOptions['placeholderFor'];
  /** Whether to record reversal mapping entries. */
  wantMapping: boolean;
}

/**
 * Resolve the placeholder for one match, allocating a new one if this
 * exact value has not been seen yet during the current pass.
 *
 * @param state - Mutable per-pass placeholder state
 * @param match - The current PII match being replaced
 * @returns The placeholder string to splice into the output
 */
function placeholderFor(state: PlaceholderState, match: PIIMatch): string {
  const cached = state.valueToPlaceholder.get(match.value);
  if (cached !== undefined) return cached;

  const next = (state.occurrenceByKind.get(match.kind) ?? 0) + 1;
  state.occurrenceByKind.set(match.kind, next);
  const placeholder = state.placeholderFor
    ? state.placeholderFor(match.kind, next)
    : defaultPlaceholder(match.kind);
  state.valueToPlaceholder.set(match.value, placeholder);
  if (state.wantMapping) state.mapping[placeholder] = match.value;
  return placeholder;
}

export function redactPII(text: string, options?: RedactPIIOptions): RedactPIIResult {
  const matches = detectPII(text, { kinds: options?.kinds });
  if (matches.length === 0) {
    return { text, redactions: [], counts: {} };
  }

  const state: PlaceholderState = {
    valueToPlaceholder: new Map(),
    occurrenceByKind: new Map(),
    mapping: {},
    placeholderFor: options?.placeholderFor,
    wantMapping: options?.reversible === true,
  };
  const counts: Partial<Record<PIIKind, number>> = {};

  const pieces: string[] = [];
  let cursor = 0;

  for (const m of matches) {
    if (m.start > cursor) pieces.push(text.slice(cursor, m.start));
    pieces.push(placeholderFor(state, m));
    counts[m.kind] = (counts[m.kind] ?? 0) + 1;
    cursor = m.end;
  }

  if (cursor < text.length) pieces.push(text.slice(cursor));

  const result: RedactPIIResult = {
    text: pieces.join(''),
    redactions: matches,
    counts,
  };
  if (state.wantMapping) result.mapping = state.mapping;
  return result;
}
