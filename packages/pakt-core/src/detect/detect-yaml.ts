/**
 * @module detect/detect-yaml
 * YAML format detection.
 *
 * Identifies YAML input through several heuristic checks:
 * - Leading `---` document separator
 * - `key: value` pair pattern (identifier followed by `: `)
 * - Indented blocks under keys (nested YAML structure)
 * - YAML list syntax (`- item` under a key)
 *
 * The detector tracks fenced code blocks to avoid counting code
 * snippets inside Markdown as YAML-like content.
 */

import type { Candidate } from './types.js';

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

/**
 * Detect YAML format from the input text and its lines.
 *
 * Examines key-value density, document separators, indented blocks,
 * and list syntax to produce a confidence score. Returns `null`
 * when no YAML signal is found.
 *
 * @param input - Full raw input text (used for list-syntax regex check)
 * @param lines - Pre-split lines of `input`
 * @returns A candidate with confidence 0.6-0.85, or `null`
 */
export function detectYaml(input: string, lines: string[]): Candidate | null {
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length === 0) return null;

  let confidence = 0;
  const reasons: string[] = [];
  const trimmedFirst = nonEmptyLines[0]!.trim();

  // Starts with --- (YAML document separator)
  if (trimmedFirst === '---') {
    confidence = 0.85;
    reasons.push('starts with --- document separator');
  }

  // Count lines that look like key: value pairs (skip code blocks)
  let kvCount = 0;
  let inCodeBlock = false;

  for (const line of nonEmptyLines) {
    const trimmed = line.trim();

    // Track fenced code blocks so we don't count code as YAML
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Key: value pattern -- key is an identifier, followed by `: ` and a value
    if (/^[a-zA-Z_][a-zA-Z0-9_.\-]*:\s+\S/.test(trimmed)) {
      kvCount++;
    }
    // Key: with nested indent (key on its own line)
    if (/^[a-zA-Z_][a-zA-Z0-9_.\-]*:\s*$/.test(trimmed)) {
      kvCount++;
    }
  }

  // Need enough key-value lines relative to total lines
  if (kvCount >= 2) {
    const kvRatio = kvCount / nonEmptyLines.length;
    if (kvRatio >= 0.5) {
      confidence = Math.max(confidence, 0.8);
      reasons.push('key-value pairs with colon separator');
    } else if (kvRatio >= 0.3) {
      confidence = Math.max(confidence, 0.7);
      reasons.push('some key-value pairs detected');
    }
  }

  // Check for YAML-specific indented blocks under keys
  let hasIndentedBlock = false;
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1]!;
    const curr = lines[i]!;
    // Previous line ends with : (key with nested content) and current is indented
    if (/^[a-zA-Z_]\S*:\s*$/.test(prev.trim()) && /^\s{2,}/.test(curr) && curr.trim().length > 0) {
      hasIndentedBlock = true;
      break;
    }
  }

  if (hasIndentedBlock) {
    confidence = Math.max(confidence, 0.75);
    if (!reasons.includes('key-value pairs with colon separator')) {
      reasons.push('indented blocks under keys');
    }
  }

  // Check for YAML list syntax (- item under a key)
  const hasYamlLists = /^\s+-\s+\S/m.test(input);
  if (hasYamlLists && kvCount >= 1) {
    confidence = Math.max(confidence, 0.75);
    reasons.push('YAML list syntax');
  }

  // Single-line key: value -- very low confidence, could be anything
  if (kvCount === 1 && nonEmptyLines.length === 1) {
    confidence = Math.max(confidence, 0.6);
    if (reasons.length === 0) reasons.push('single key-value pair');
  }

  // No YAML signal found
  if (confidence === 0) return null;

  return {
    format: 'yaml',
    confidence: Math.round(confidence * 100) / 100,
    reason: reasons.join('; ') || 'YAML structure detected',
  };
}
