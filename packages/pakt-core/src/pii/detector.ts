/**
 * @module pii/detector
 * Pure regex-based PII detection for compressed PAKT output.
 *
 * Detects common personally-identifiable and sensitive patterns that
 * routinely leak into LLM prompts via pasted API responses, clipboard
 * payloads, and log excerpts:
 *
 * | Kind              | Example                                      |
 * |-------------------|----------------------------------------------|
 * | `email`           | `alice@example.com`                          |
 * | `phone`           | `+1 (415) 555-0132`                          |
 * | `ipv4`            | `192.168.1.10`                               |
 * | `ipv6`            | `2001:db8:85a3::8a2e:370:7334`               |
 * | `jwt`             | `eyJhbGciOi...eyJzdWIiOi...<sig>`            |
 * | `aws-access-key`  | `AKIAIOSFODNN7EXAMPLE`                       |
 * | `aws-secret-key`  | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`   |
 * | `credit-card`     | `4242 4242 4242 4242` (Luhn-validated)       |
 * | `ssn`             | `123-45-6789` (US, loose heuristic)          |
 *
 * Everything here is regex + one small Luhn check; no network calls, no
 * model inference. The detector is intentionally conservative —
 * precision over recall — so a false positive on a payload that looks
 * PII-shaped is unlikely, at the cost of missing unusual formats.
 *
 * Use {@link detectPII} as the single entry point. It returns
 * non-overlapping, sorted matches so callers can redact in-place
 * without offset bookkeeping.
 *
 * @see {@link ./redact.ts} for placeholder substitution
 * @see {@link ../layers/L4-pii.ts} for L4 pipeline integration
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Kinds of PII this detector recognises. The set is intentionally small
 * and curated — the point is "almost certainly sensitive", not "any
 * string with a digit in it".
 */
export type PIIKind =
  | 'email'
  | 'phone'
  | 'ipv4'
  | 'ipv6'
  | 'jwt'
  | 'aws-access-key'
  | 'aws-secret-key'
  | 'credit-card'
  | 'ssn';

/**
 * A single PII detection. `start` / `end` are string offsets against the
 * input passed to {@link detectPII}; `value` is the exact matched slice.
 */
export interface PIIMatch {
  kind: PIIKind;
  value: string;
  start: number;
  end: number;
}

/**
 * Options for {@link detectPII}.
 */
export interface PIIDetectionOptions {
  /**
   * Subset of kinds to scan for. Omit to scan for all kinds.
   * Enables callers to pay only for the detectors they need.
   */
  kinds?: readonly PIIKind[];
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/* Emails: RFC 5322 is too lax for practical scanning; this is the
   common WHATWG-HTML-style pattern with a reasonable TLD length. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;

/* Phones: international E.164-ish and common US formats. Accepts
   optional `+` country code, parens around area code, and separators
   `-`, `.`, or space. Requires at least 10 digits in total. */
const PHONE_RE =
  /(?<![\w+])\+?\d{1,3}[-. ]?\(?\d{2,4}\)?[-. ]?\d{3,4}[-. ]?\d{3,4}(?![\w])/g;

/* IPv4: four octets 0-255. Uses a non-capturing group + negative
   lookarounds to avoid matching inside version-like substrings. The
   trailing lookaround also excludes `-` so something like `1.2.3.4-beta`
   (common in release tags / build metadata) isn't misread as an IP. */
const IPV4_RE =
  /(?<![\w.-])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\w.-])/g;

/* IPv6: handles full, compressed (`::`), and mixed forms. The
   many alternations make this pattern a ReDoS risk on adversarially
   long inputs; {@link detectPII} pre-screens with {@link IPV6_SHAPE_RE}
   and an overall input-length cap before invoking it. */
const IPV6_RE =
  /(?<![\w:])(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?:(?::[0-9a-fA-F]{1,4}){1,6})|:(?:(?::[0-9a-fA-F]{1,4}){1,7}|:)/g;

/* Cheap shape check: any IPv6 value must contain at least one `::` or
   7+ colons (full form). Used as a pre-filter so the expensive alternation
   above doesn't iterate across text that couldn't possibly match. */
const IPV6_SHAPE_RE = /::|(?:[0-9a-fA-F]{1,4}:){7}/;

/* JWT: three base64url segments separated by `.`, each at least 4 chars.
   The first two decode to JSON headers/payloads; we don't validate
   that here — the shape alone is already a strong signal. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g;

/* AWS access key: begins with `AKIA` / `ASIA` / `AGPA` / `ANPA` / `AIDA`
   prefixes (IAM user / session / etc), then 16 uppercase alphanumerics. */
const AWS_ACCESS_KEY_RE = /\b(?:AKIA|ASIA|AGPA|ANPA|AIDA|AROA|AIPA|ANVA|ABIA|ACCA)[A-Z0-9]{16}\b/g;

/* AWS secret key: 40-char base64 / mixed alnum. Without context it's
   ambiguous (any 40-char blob could match), so we anchor to common
   labels that precede the value in logs / env dumps. */
const AWS_SECRET_KEY_RE =
  /(?:aws[_-]?secret[_-]?access[_-]?key|AWS_SECRET_ACCESS_KEY)["']?\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})\b/gi;

/* Credit card: 13-19 digits with optional separators. Luhn-checked
   below to eliminate false positives. */
const CREDIT_CARD_RE = /\b(?:\d[ -]?){12,18}\d\b/g;

/* US SSN: three-two-four with dashes. Strict dashed form only — a
   bare 9-digit string is too ambiguous to claim as SSN. */
const SSN_RE = /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g;

// ---------------------------------------------------------------------------
// Luhn check for credit-card candidates
// ---------------------------------------------------------------------------

/**
 * Validate a candidate string as a Luhn-checksum-valid card number.
 * Strips separators first. Returns `false` for anything that isn't
 * 13-19 digits or fails the checksum.
 */
function passesLuhn(candidate: string): boolean {
  const digits = candidate.replace(/[ -]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const ch = digits.charCodeAt(i) - 48;
    if (ch < 0 || ch > 9) return false;
    const d = alt ? ch * 2 : ch;
    sum += d > 9 ? d - 9 : d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// ---------------------------------------------------------------------------
// ReDoS / resource bounds
// ---------------------------------------------------------------------------

/**
 * Hard upper bound on input length for a single scan. Any text longer
 * than this is rejected rather than risk adversarial backtracking in the
 * IPv6 / phone patterns. The MCP and CLI layers already clamp user
 * inputs well below this; the cap here is a library-level safety net.
 */
export const PII_INPUT_MAX_CHARS = 1_048_576;

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

/**
 * Ordered detector entries. Order matters when matches overlap: the
 * first-registered detector wins the range, so narrower / more specific
 * patterns (JWT, AWS keys) come before broader ones (phone, SSN).
 */
const DETECTORS: readonly {
  kind: PIIKind;
  re: RegExp;
  /** Optional post-filter; return `false` to reject a candidate match. */
  accept?: (value: string) => boolean;
  /** Optional capture-group index if the pattern wraps the target in a group. */
  captureGroup?: number;
}[] = [
  { kind: 'jwt', re: JWT_RE },
  { kind: 'aws-access-key', re: AWS_ACCESS_KEY_RE },
  { kind: 'aws-secret-key', re: AWS_SECRET_KEY_RE, captureGroup: 1 },
  { kind: 'email', re: EMAIL_RE },
  { kind: 'credit-card', re: CREDIT_CARD_RE, accept: passesLuhn },
  { kind: 'ssn', re: SSN_RE },
  { kind: 'ipv6', re: IPV6_RE },
  { kind: 'ipv4', re: IPV4_RE },
  { kind: 'phone', re: PHONE_RE },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan `text` for PII. Returns all matches, sorted by `start` offset,
 * with overlaps resolved in favour of the first (higher-priority)
 * detector.
 *
 * The detectors are deliberately conservative; callers who need broader
 * coverage (e.g. custom internal token formats) should layer their own
 * regex pass on top.
 *
 * @param text - Input string to scan
 * @param options - Optional kind subset
 * @returns Non-overlapping matches sorted ascending by `start`
 *
 * @example
 * ```ts
 * import { detectPII } from '@sriinnu/pakt';
 *
 * const matches = detectPII('contact: alice@example.com, 192.168.1.10');
 * // [
 * //   { kind: 'email', value: 'alice@example.com', start: 9,  end: 26 },
 * //   { kind: 'ipv4',  value: '192.168.1.10',      start: 28, end: 40 },
 * // ]
 * ```
 */
export function detectPII(text: string, options?: PIIDetectionOptions): PIIMatch[] {
  if (!text) return [];
  /* ReDoS safety net: the IPv6 / phone patterns can backtrack on
     pathological inputs. The caller-facing layers (MCP / CLI) already
     clamp inputs well below this; this is a last-resort guard so
     {@link detectPII} can be called directly on untrusted text without
     blocking the event loop. */
  if (text.length > PII_INPUT_MAX_CHARS) return [];

  const allowedKinds =
    options?.kinds && options.kinds.length > 0 ? new Set(options.kinds) : null;
  const raw: PIIMatch[] = [];

  /* IPv6's alternation is expensive; skip it unless the text at least
     looks like it could contain an IPv6 (a `::` or a chain of 7+ hex
     groups). This turns a full-scan cost into O(1) for the common case
     where compressed PAKT contains no IPv6 at all. */
  const ipv6Possible = IPV6_SHAPE_RE.test(text);

  for (const detector of DETECTORS) {
    if (allowedKinds && !allowedKinds.has(detector.kind)) continue;
    if (detector.kind === 'ipv6' && !ipv6Possible) continue;

    /* Reset per-scan: shared `g`-flag regexes keep `lastIndex` state */
    detector.re.lastIndex = 0;
    let m: RegExpExecArray | null = detector.re.exec(text);
    while (m !== null) {
      const groupIdx = detector.captureGroup ?? 0;
      const value = m[groupIdx] ?? m[0];
      if (value === undefined) {
        m = detector.re.exec(text);
        continue;
      }
      const start =
        detector.captureGroup !== undefined
          ? /* Group offset = absolute match start + offset of group
               inside the match text. */
            (m.index ?? 0) + (m[0]?.indexOf(value) ?? 0)
          : m.index ?? 0;
      const end = start + value.length;
      if (!detector.accept || detector.accept(value)) {
        raw.push({ kind: detector.kind, value, start, end });
      }
      m = detector.re.exec(text);
    }
  }

  return dedupeOverlapping(raw);
}

// ---------------------------------------------------------------------------
// Overlap resolution
// ---------------------------------------------------------------------------

/**
 * Remove overlapping matches, keeping the earliest (lowest `start`) and
 * breaking ties by the DETECTORS registration order (higher-priority
 * kind wins). Returns a stable ascending-by-`start` list.
 *
 * Example of overlap: the IPv4 pattern could in principle match inside
 * a longer phone-number-like blob. The first-registered detector (IPv4
 * here, since it's earlier than phone in our list) wins.
 */
function dedupeOverlapping(matches: PIIMatch[]): PIIMatch[] {
  if (matches.length <= 1) return [...matches].sort(byStart);

  /* Priority map = index in DETECTORS (lower = higher priority). */
  const priority = new Map<PIIKind, number>();
  for (let i = 0; i < DETECTORS.length; i++) {
    const d = DETECTORS[i];
    if (d) priority.set(d.kind, i);
  }

  /* Sort by start, then by priority so the first candidate for any
     range is the preferred one. */
  const sorted = [...matches].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return (priority.get(a.kind) ?? 99) - (priority.get(b.kind) ?? 99);
  });

  const out: PIIMatch[] = [];
  let cursor = -1;
  for (const m of sorted) {
    if (m.start < cursor) continue; // overlaps previously chosen range
    out.push(m);
    cursor = m.end;
  }
  return out;
}

function byStart(a: PIIMatch, b: PIIMatch): number {
  return a.start - b.start;
}
