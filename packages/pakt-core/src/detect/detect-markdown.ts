/**
 * @module detect/detect-markdown
 * Markdown format detection.
 *
 * Identifies Markdown input by scanning for multiple structural signals:
 * - `#` headings (h1-h6)
 * - Markdown table separators (`| --- |`)
 * - Bold formatting (`**text**` or `__text__`)
 * - Task lists (`- [ ]` / `- [x]`)
 * - Fenced code blocks (triple backticks)
 * - Link syntax (`[text](url)`)
 *
 * Each signal adds to a cumulative score. The final confidence is
 * capped at 0.95 and floored at 0.75 (when any signal is present).
 */

import type { Candidate } from './types.js';

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

/**
 * Detect Markdown format from the input text and its lines.
 *
 * Accumulates a score from independent signal checks. Returns `null`
 * when no Markdown signal is found.
 *
 * @param input - Full raw input text
 * @param lines - Pre-split lines of `input`
 * @returns A candidate with confidence 0.75-0.95, or `null`
 */
export function detectMarkdown(input: string, lines: string[]): Candidate | null {
  let score = 0;
  const reasons: string[] = [];
  const trimmedFirst = lines[0]?.trim() ?? '';

  // Starts with # heading -- strong signal
  if (/^#{1,6}\s+\S/.test(trimmedFirst)) {
    score += 0.9;
    reasons.push('starts with # heading');
  }

  // Contains markdown table pattern: | --- | or |---| or | :--- |
  if (/\|[\s-:]+\|/.test(input)) {
    score += 0.85;
    reasons.push('contains markdown table separator');
  }

  // Contains ## or ### headings (not at start -- that's already caught)
  if (/^#{2,6}\s+\S/m.test(input) && !reasons.includes('starts with # heading')) {
    score += 0.8;
    reasons.push('contains markdown headings');
  }

  // Contains bold **text** or __text__
  if (/\*\*[^*]+\*\*/.test(input) || /__[^_]+__/.test(input)) {
    score += 0.3;
    reasons.push('contains bold formatting');
  }

  // Contains task lists - [ ] or - [x]
  if (/^[-*]\s+\[[ x]\]/m.test(input)) {
    score += 0.3;
    reasons.push('contains task list');
  }

  // Contains fenced code blocks ```
  if (/^```/m.test(input)) {
    score += 0.3;
    reasons.push('contains fenced code block');
  }

  // Contains [text](url) link syntax
  if (/\[[^\]]+\]\([^)]+\)/.test(input)) {
    score += 0.75;
    reasons.push('contains markdown link syntax');
  }

  // No markdown signals detected
  if (score === 0) return null;

  // Cap confidence at 0.95, floor at 0.75
  const confidence = Math.min(
    0.95,
    Math.max(0.75, score > 1 ? 0.75 + (score - 0.75) * 0.15 : score),
  );

  return {
    format: 'markdown',
    confidence: Math.round(confidence * 100) / 100,
    reason: reasons.length > 1
      ? `Multiple markdown signals: ${reasons.join(', ')}`
      : reasons[0] ? `Contains ${reasons[0]}` : 'Markdown patterns detected',
  };
}
