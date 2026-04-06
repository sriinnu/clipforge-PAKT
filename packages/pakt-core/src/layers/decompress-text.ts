/**
 * @module layers/decompress-text
 * Reverses text-level phrase compression produced by {@link compressText}.
 *
 * Parses the `@dict` block to recover alias-to-phrase mappings, then
 * expands every alias occurrence in the body back to its original phrase.
 */

import { replaceAll } from '../utils/replace-all.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decompress a text-compressed PAKT string back to the original text.
 *
 * Expects input in the format produced by {@link compressText}:
 * ```
 * @from text
 * @dict
 *   $a: The engineering team
 *   $b: machine learning
 * @end
 * body text with $a and $b aliases...
 * ```
 *
 * If no `@dict` block is found, returns the input unchanged (after
 * stripping the `@from` header if present).
 *
 * Aliases are expanded longest-first to avoid partial replacements
 * (e.g. `$aa` before `$a`).
 *
 * @param input - The compressed text with alias header
 * @returns The fully expanded original text
 *
 * @example
 * ```ts
 * const original = decompressText(compressed);
 * ```
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: text decompression reverses multiple preprocessing layers
export function decompressText(input: string): string {
  // Parse all header lines (everything before the body)
  const lines = input.split('\n');
  let bodyStartIdx = 0;

  // Extract metadata headers and dict block
  const wsMeta = {
    trailing: [] as Array<[number, string]>,
    blankRuns: [] as Array<[number, number]>,
  };
  const aliases: Array<{ alias: string; phrase: string }> = [];
  let inDict = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (trimmed.startsWith('@from ')) {
      bodyStartIdx = i + 1;
      continue;
    }
    if (trimmed === '@dict') {
      inDict = true;
      bodyStartIdx = i + 1;
      continue;
    }
    if (trimmed === '@end' && inDict) {
      inDict = false;
      bodyStartIdx = i + 1;
      continue;
    }
    if (inDict) {
      const match = trimmed.match(/^(\$[a-z]{1,2}):\s+(.+)$/);
      if (match?.[1] && match[2]) {
        aliases.push({ alias: match[1], phrase: match[2] });
      }
      bodyStartIdx = i + 1;
      continue;
    }
    if (trimmed.startsWith('@ws-trail ')) {
      const data = trimmed.slice('@ws-trail '.length);
      for (const pair of data.split(',')) {
        const [lineStr, encoded] = pair.split(':');
        if (lineStr && encoded) {
          wsMeta.trailing.push([Number(lineStr), decodeWs(encoded)]);
        }
      }
      bodyStartIdx = i + 1;
      continue;
    }
    if (trimmed.startsWith('@ws-blanks ')) {
      const data = trimmed.slice('@ws-blanks '.length);
      for (const pair of data.split(',')) {
        const [lineStr, countStr] = pair.split(':');
        if (lineStr && countStr) {
          wsMeta.blankRuns.push([Number(lineStr), Number(countStr)]);
        }
      }
      bodyStartIdx = i + 1;
      continue;
    }
    // Not a header line — this is where the body starts
    break;
  }

  // Extract body
  let body = lines.slice(bodyStartIdx).join('\n');

  // Step 1: Expand dictionary aliases (longest-first)
  if (aliases.length > 0) {
    const sorted = [...aliases].sort((a, b) => b.alias.length - a.alias.length);
    for (const { alias, phrase } of sorted) {
      body = replaceAll(body, alias, phrase);
    }
  }

  // Step 2: Expand line dedup references (@L<N>)
  const bodyLines = body.split('\n');
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i] ?? '';
    if (line.startsWith('@L')) {
      const refLine = Number(line.slice(2));
      if (!Number.isNaN(refLine) && refLine >= 0 && refLine < bodyLines.length) {
        const target = bodyLines[refLine];
        if (target !== undefined) bodyLines[i] = target;
      }
    }
  }
  body = bodyLines.join('\n');

  // Step 3: Restore blank line runs
  if (wsMeta.blankRuns.length > 0) {
    const expandedLines = body.split('\n');
    // Process in reverse to preserve line indices
    for (let i = wsMeta.blankRuns.length - 1; i >= 0; i--) {
      const entry = wsMeta.blankRuns[i];
      if (!entry) continue;
      const [lineNum, count] = entry;
      // Replace the single blank line with the original run
      const blanks = Array(count).fill('') as string[];
      expandedLines.splice(lineNum, 1, ...blanks);
    }
    body = expandedLines.join('\n');
  }

  // Step 4: Restore trailing whitespace
  if (wsMeta.trailing.length > 0) {
    const finalLines = body.split('\n');
    for (const [lineNum, ws] of wsMeta.trailing) {
      if (lineNum < finalLines.length) {
        finalLines[lineNum] = (finalLines[lineNum] ?? '') + ws;
      }
    }
    body = finalLines.join('\n');
  }

  return body;
}

/** Decode whitespace encoding from @ws-trail metadata. */
function decodeWs(encoded: string): string {
  return encoded.replace(/s/g, ' ').replace(/t/g, '\t').replace(/r/g, '\r');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
