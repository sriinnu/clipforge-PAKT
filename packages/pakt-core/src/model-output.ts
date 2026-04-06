/**
 * @module model-output
 * Interpret LLM responses that may contain raw text or valid PAKT.
 *
 * This helper centralizes the common application flow:
 * detect -> validate -> repair -> decompress -> fallback.
 */

import { decompress } from './decompress.js';
import { detect } from './detect.js';
import type { ModelOutputOptions, ModelOutputResult, PaktFormat } from './types.js';
import { repair, validate } from './utils/validate.js';

const FENCED_BLOCK_RE = /```[^\n`]*\n([\s\S]*?)```/g;

/**
 * Interpret an LLM response that may contain valid PAKT.
 *
 * If the response is valid PAKT, or contains a valid PAKT fenced block, the
 * helper decompresses it back to the requested format. If the PAKT is slightly
 * malformed, it optionally attempts best-effort repair first. Otherwise it
 * returns the original response unchanged so callers can continue evaluating it
 * as normal prose or JSON.
 *
 * @param response - Raw model response text
 * @param options - Output/repair options
 * @returns Interpretation result describing whether decompression occurred
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: output interpretation handles multiple detection paths and fallback strategies
export function interpretModelOutput(
  response: string,
  options?: Partial<ModelOutputOptions>,
): ModelOutputResult {
  const attemptRepair = options?.attemptRepair ?? true;
  const extractFenced = options?.extractFenced ?? true;
  const responseFormat = detect(response).format;
  const candidates = collectCandidates(response, extractFenced);

  let firstInvalid:
    | {
        text: string;
        extractedFromFence: boolean;
        validation: ReturnType<typeof validate>;
      }
    | undefined;

  for (const candidate of candidates) {
    const validation = validate(candidate.text);
    if (validation.valid) {
      return buildDecompressedResult(
        response,
        responseFormat,
        candidate,
        validation,
        false,
        options,
      );
    }

    if (!firstInvalid) {
      firstInvalid = {
        text: candidate.text,
        extractedFromFence: candidate.extractedFromFence,
        validation,
      };
    }

    if (!attemptRepair) {
      continue;
    }

    const repaired = repair(candidate.text);
    if (!repaired) {
      continue;
    }

    const repairedValidation = validate(repaired);
    if (repairedValidation.valid) {
      return buildDecompressedResult(
        response,
        responseFormat,
        {
          text: repaired,
          extractedFromFence: candidate.extractedFromFence,
        },
        repairedValidation,
        true,
        options,
      );
    }

    if (!firstInvalid) {
      firstInvalid = {
        text: repaired,
        extractedFromFence: candidate.extractedFromFence,
        validation: repairedValidation,
      };
    }
  }

  if (firstInvalid) {
    return {
      action: 'invalid-pakt',
      text: response,
      data: response,
      originalText: response,
      candidateText: firstInvalid.text,
      responseFormat,
      wasLossy: false,
      repaired: false,
      extractedFromFence: firstInvalid.extractedFromFence,
      validation: firstInvalid.validation,
    };
  }

  return {
    action: 'passthrough',
    text: response,
    data: response,
    originalText: response,
    responseFormat,
    wasLossy: false,
    repaired: false,
    extractedFromFence: false,
  };
}

function buildDecompressedResult(
  response: string,
  responseFormat: PaktFormat,
  candidate: { text: string; extractedFromFence: boolean },
  validation: ReturnType<typeof validate>,
  repaired: boolean,
  options?: Partial<ModelOutputOptions>,
): ModelOutputResult {
  const decompressed = decompress(candidate.text, options?.outputFormat);
  return {
    action: repaired ? 'repaired-decompressed' : 'decompressed',
    text: decompressed.text,
    data: decompressed.data,
    originalText: response,
    candidateText: candidate.text,
    responseFormat,
    originalFormat: decompressed.originalFormat,
    wasLossy: decompressed.wasLossy,
    repaired,
    extractedFromFence: candidate.extractedFromFence,
    validation,
  };
}

function collectCandidates(
  response: string,
  extractFenced: boolean,
): Array<{ text: string; extractedFromFence: boolean }> {
  const candidates: Array<{ text: string; extractedFromFence: boolean }> = [];
  const seen = new Set<string>();

  const pushCandidate = (text: string, extractedFromFence: boolean): void => {
    const normalized = text.trim();
    if (normalized.length === 0 || seen.has(normalized) || !looksLikePaktCandidate(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push({ text: normalized, extractedFromFence });
  };

  if (extractFenced) {
    for (const match of response.matchAll(FENCED_BLOCK_RE)) {
      const block = match[1];
      if (!block) continue;
      pushCandidate(block, true);
    }
  }

  const normalizedResponse = response.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedResponse.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]?.trim().startsWith('@from ')) {
      continue;
    }
    pushCandidate(lines.slice(i).join('\n'), false);
  }

  pushCandidate(response, false);

  return candidates;
}

function looksLikePaktCandidate(text: string): boolean {
  if (detect(text).format === 'pakt') {
    return true;
  }

  return /(^|\n)\s*@from\b/.test(text) || /(^|\n)\s*@dict\b/.test(text);
}
