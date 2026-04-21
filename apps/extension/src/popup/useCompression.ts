/**
 * @module useCompression
 * React hook encapsulating all compression and decompression logic for the
 * ClipForge popup.
 */

import {
  compress,
  compressMixed,
  countTokens,
  createProfiledPaktOptions,
  decompress,
  decompressMixed,
  estimateCompressibility,
} from '@sriinnu/pakt';
import type {
  CompressibilityLabel,
  DecompressResult,
  MixedCompressResult,
  PaktFormat,
  PaktResult,
} from '@sriinnu/pakt';
import { useCallback } from 'react';
import type { ExtensionSettings } from '../shared/storage';

export interface CompressionStats {
  before: number;
  after: number;
  savings: number;
}

/** Pre-compression compressibility estimate exposed to the UI. */
export interface CompressibilityInfo {
  /** Numeric score from 0.0 to 1.0 */
  score: number;
  /** Human-readable label: low | moderate | good | high | excellent */
  label: CompressibilityLabel;
}

export interface CompressionHandlers {
  setOutput: (text: string) => void;
  setStats: (stats: CompressionStats | null) => void;
  setStatusMsg: (msg: { text: string; type: 'success' | 'error' | 'info' } | null) => void;
  setProcessing: (value: boolean) => void;
  setCompressibility: (info: CompressibilityInfo | null) => void;
  setDeltaEncoded: (value: boolean) => void;
}

const MIN_MEANINGFUL_SAVINGS_PERCENT = 1;

export function useCompression(
  settings: ExtensionSettings | null,
  processing: boolean,
  detectedFormat: PaktFormat,
  input: string,
  decompressFormat: PaktFormat,
  handlers: CompressionHandlers,
) {
  const { setOutput, setStats, setStatusMsg, setProcessing, setCompressibility, setDeltaEncoded } =
    handlers;

  const runCompress = useCallback(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: compression hook manages multiple async states
    (text: string, isAuto = false, onAutoNotice?: () => void) => {
      if (!text.trim() || processing || !settings) return;
      setStatusMsg(null);
      setProcessing(true);
      setDeltaEncoded(false);

      /* Estimate compressibility before running the pipeline */
      try {
        const estimate = estimateCompressibility(text);
        setCompressibility({ score: estimate.score, label: estimate.label });
      } catch {
        setCompressibility(null);
      }

      try {
        const options = createProfiledPaktOptions(settings.compressionProfileId, {
          ...(settings.compressionProfileId === 'semantic'
            ? { semanticBudget: settings.semanticBudget }
            : {}),
          targetModel: settings.targetModel,
        });

        let compressed: string;
        let originalTokens: number;
        let compressedTokens: number;
        let savingsPercent: number;

        if (detectedFormat === 'markdown' || detectedFormat === 'text') {
          const result: MixedCompressResult = compressMixed(text, options);
          compressed = result.compressed;
          originalTokens = result.originalTokens;
          compressedTokens = result.compressedTokens;
          savingsPercent = result.savings.totalPercent;
        } else {
          const result: PaktResult = compress(text, options);
          compressed = result.compressed;
          originalTokens = result.originalTokens;
          compressedTokens = result.compressedTokens;
          savingsPercent = result.savings.totalPercent;
        }

        setStats({ before: originalTokens, after: compressedTokens, savings: savingsPercent });

        if (compressedTokens >= originalTokens || savingsPercent < MIN_MEANINGFUL_SAVINGS_PERCENT) {
          setOutput('');
          setStatusMsg({
            text: 'Skipped: no meaningful token win for this payload.',
            type: 'info',
          });
          return;
        }

        setOutput(compressed);

        /* Check if delta encoding was used in the compressed output */
        if (compressed.includes('@compress delta')) {
          setDeltaEncoded(true);
        }

        setStatusMsg({
          text: `Packed locally with ${Math.round(savingsPercent)}% token savings.`,
          type: 'success',
        });

        if (isAuto && onAutoNotice) onAutoNotice();
      } catch (err) {
        setOutput('');
        setStatusMsg({
          text: err instanceof Error ? err.message : 'Compression failed',
          type: 'error',
        });
      } finally {
        setProcessing(false);
      }
    },
    [
      settings,
      processing,
      detectedFormat,
      setOutput,
      setStats,
      setStatusMsg,
      setProcessing,
      setCompressibility,
      setDeltaEncoded,
    ],
  );

  const handleDecompress = useCallback(() => {
    if (!input.trim() || processing) return;
    setStatusMsg(null);
    setProcessing(true);
    try {
      const mixedOut = decompressMixed(input);

      let outputText: string;
      if (mixedOut !== input) {
        outputText = mixedOut;
      } else {
        const result: DecompressResult = decompress(input, decompressFormat);
        outputText = result.text;
      }

      setOutput(outputText);
      const beforeTokens = countTokens(input, settings?.targetModel);
      const afterTokens = countTokens(outputText, settings?.targetModel);
      const savingsPercent =
        afterTokens > 0 ? Math.round(((afterTokens - beforeTokens) / afterTokens) * 100) : 0;
      setStats({ before: beforeTokens, after: afterTokens, savings: savingsPercent });
      setStatusMsg({ text: 'Restored locally from PAKT.', type: 'success' });
    } catch (err) {
      setOutput('');
      setStatusMsg({
        text: err instanceof Error ? err.message : 'Decompression failed',
        type: 'error',
      });
    } finally {
      setProcessing(false);
    }
  }, [
    input,
    decompressFormat,
    processing,
    settings?.targetModel,
    setOutput,
    setStats,
    setStatusMsg,
    setProcessing,
  ]);

  return { runCompress, handleDecompress };
}
