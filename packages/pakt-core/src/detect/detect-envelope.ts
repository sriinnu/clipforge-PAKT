/**
 * @module detect/detect-envelope
 * HTTP envelope detection.
 *
 * Detects when raw input is wrapped in an HTTP response envelope
 * (status line + headers + blank line + body). When found, the
 * main `detect()` function strips the envelope and runs detection
 * on the body content alone.
 *
 * Recognised patterns:
 * - `HTTP/1.1 200 OK`
 * - `HTTP/2 200`
 * - `HTTP 200 OK`
 *
 * Headers must match the standard `Header-Name: value` format.
 * The body may start after a blank line or directly after headers
 * if it begins with `{` or `[`.
 */

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/** HTTP status line: `HTTP/1.1 200 OK`, `HTTP/2 200`, `HTTP 200 OK` */
const HTTP_STATUS_RE = /^HTTP(?:\/\d+(?:\.\d+)?)?\s+\d{3}(?:\s+.*)?$/;

/** Standard HTTP header: `Header-Name: value` */
const HTTP_HEADER_RE = /^[A-Za-z][A-Za-z0-9-]*:\s/;

// ---------------------------------------------------------------------------
// Envelope result type
// ---------------------------------------------------------------------------

/** Shape returned by detectEnvelope when an HTTP envelope is found */
export interface EnvelopeDetection {
  /** Header lines (status + headers), trimmed and non-empty */
  preamble: string[];
  /** The body content after the envelope headers */
  body: string;
  /** Byte offset in the original input where the body starts */
  bodyOffset: number;
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

/**
 * Detect an HTTP envelope (status line + headers) wrapping a body.
 *
 * Scans from the first line for an HTTP status line, then validates
 * subsequent lines as HTTP headers until a blank line or body-start
 * character (`{` or `[`) is found.
 *
 * @param input - Full raw input text
 * @returns Envelope info with preamble, body, and byte offset, or `null`
 */
export function detectEnvelope(input: string): EnvelopeDetection | null {
  const lines = input.split('\n');

  // First non-empty line must look like an HTTP status line
  const firstLine = lines[0]?.trim() ?? '';
  if (!HTTP_STATUS_RE.test(firstLine)) return null;

  // Scan headers until blank line or body start
  let bodyLineIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i]?.trim();

    // Blank line separates headers from body
    if (trimmed === '') {
      bodyLineIdx = i + 1;
      break;
    }

    // Must look like an HTTP header
    if (HTTP_HEADER_RE.test(trimmed)) continue;

    // Not a header -- check if it's the body starting without blank separator
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      bodyLineIdx = i;
      break;
    }

    // Unrecognized line -- not a valid HTTP envelope
    return null;
  }

  if (bodyLineIdx === -1 || bodyLineIdx >= lines.length) return null;

  const preamble = lines
    .slice(0, bodyLineIdx)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const body = lines.slice(bodyLineIdx).join('\n').trim();

  // Body must be non-empty
  if (body.length === 0) return null;

  // Need at least the status line + 1 header to qualify
  if (preamble.length < 2) return null;

  // Compute byte offset of body in original input
  let bodyOffset = 0;
  for (let i = 0; i < bodyLineIdx; i++) {
    bodyOffset += lines[i]?.length + 1; // +1 for \n
  }

  return { preamble, body, bodyOffset };
}
