/**
 * @module useCompression
 * React hook encapsulating all compression and decompression logic for the
 * ClipForge popup.
 *
 * Provides `runCompress` and `handleDecompress` handlers that route text
 * through the appropriate PAKT functions based on detected format.
 */

import { compress, compressMixed, countTokens, decompress, decompressMixed } from '@sriinnu/pakt';
import type { DecompressResult, MixedCompressResult, PaktFormat, PaktResult } from '@sriinnu/pakt';
import { useCallback } from 'react';
import type { ExtensionSettings } from '../shared/storage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Stats snapshot updated after each compress/decompress run. */
export interface CompressionStats {
  before: number;
  after: number;
  savings: number;
}

/** Callbacks used by the hook to push state back into the component. */
export interface CompressionHandlers {
  /** Called to update the output text. */
  setOutput: (text: string) => void;
  /** Called to update the stats panel. */
  setStats: (stats: CompressionStats | null) => void;
  /** Called to report an error or success message. */
  setStatusMsg: (msg: { text: string; type: 'success' | 'error' } | null) => void;
  /** Called to toggle the processing spinner. */
  setProcessing: (value: boolean) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook that builds the `runCompress` and `handleDecompress` functions.
 *
 * Routes compression through `compressMixed` for text/markdown inputs (so
 * embedded JSON/YAML/CSV blocks are also compressed) and through `compress`
 * for structured formats. Decompression tries `decompressMixed` first to
 * resolve embedded PAKT markers before falling back to plain `decompress`.
 *
 * @param settings - Current extension settings (may be null before load).
 * @param processing - Whether a job is already running (guards double-submit).
 * @param detectedFormat - Format detected in the current input.
 * @param input - Current value of the input textarea (needed for decompress).
 * @param decompressFormat - Fallback format hint for plain decompress.
 * @param handlers - State-update callbacks from the parent component.
 * @returns `{ runCompress, handleDecompress }` as stable memoised callbacks.
 */
export function useCompression(
  settings: ExtensionSettings | null,
  processing: boolean,
  detectedFormat: PaktFormat,
  input: string,
  decompressFormat: PaktFormat,
  handlers: CompressionHandlers,
) {
  const { setOutput, setStats, setStatusMsg, setProcessing } = handlers;

  /**
   * Compresses the given text and updates output/stats state.
   *
   * Routes text/markdown through `compressMixed` (handles embedded structured
   * blocks) and structured formats (json/yaml/csv) through `compress`.
   *
   * @param text - The raw input text to compress.
   * @param isAuto - Whether triggered by auto-compress (shows notice banner).
   * @param onAutoNotice - Optional callback invoked when isAuto=true to show the banner.
   */
  const runCompress = useCallback(
    (text: string, isAuto = false, onAutoNotice?: () => void) => {
      if (!text.trim() || processing) return;
      setStatusMsg(null);
      setProcessing(true);
      try {
        const layerOpts = {
          structural: settings?.layerStructural ?? true,
          dictionary: settings?.layerDictionary ?? true,
          tokenizerAware: false,
          semantic: false,
        };

        let compressed: string;
        let originalTokens: number;
        let compressedTokens: number;
        let savingsPercent: number;

        if (detectedFormat === 'markdown' || detectedFormat === 'text') {
          // Mixed-content path: handles embedded JSON/YAML/CSV blocks in prose
          const result: MixedCompressResult = compressMixed(text, { layers: layerOpts });
          compressed = result.compressed;
          originalTokens = result.originalTokens;
          compressedTokens = result.compressedTokens;
          savingsPercent = result.savings.totalPercent;
        } else {
          // Structured format path (json/yaml/csv)
          const result: PaktResult = compress(text, { layers: layerOpts });
          compressed = result.compressed;
          originalTokens = result.originalTokens;
          compressedTokens = result.compressedTokens;
          savingsPercent = result.savings.totalPercent;
        }

        setOutput(compressed);
        setStats({ before: originalTokens, after: compressedTokens, savings: savingsPercent });

        if (isAuto && onAutoNotice) onAutoNotice();
      } catch (err) {
        setStatusMsg({
          text: err instanceof Error ? err.message : 'Compression failed',
          type: 'error',
        });
      } finally {
        setProcessing(false);
      }
    },
    [settings, processing, detectedFormat, setOutput, setStats, setStatusMsg, setProcessing],
  );

  /**
   * Decompresses the current input and updates output/stats state.
   *
   * Tries `decompressMixed` first to handle documents with embedded PAKT
   * markers (`<!-- PAKT:format -->...<!-- /PAKT -->`). Falls back to the
   * plain `decompress` call when no mixed markers are detected.
   */
  const handleDecompress = useCallback(() => {
    if (!input.trim() || processing) return;
    setStatusMsg(null);
    setProcessing(true);
    try {
      // Try mixed decompression first — returns input unchanged if no markers found
      const mixedOut = decompressMixed(input);

      let outputText: string;
      if (mixedOut !== input) {
        // Mixed markers were found and resolved
        outputText = mixedOut;
      } else {
        // Fallback: plain decompress for pure PAKT documents
        const result: DecompressResult = decompress(input, decompressFormat);
        outputText = result.text;
      }

      setOutput(outputText);
      const beforeTokens = countTokens(input);
      const afterTokens = countTokens(outputText);
      const savingsPercent =
        afterTokens > 0 ? Math.round(((afterTokens - beforeTokens) / afterTokens) * 100) : 0;
      setStats({ before: beforeTokens, after: afterTokens, savings: savingsPercent });
    } catch (err) {
      setStatusMsg({
        text: err instanceof Error ? err.message : 'Decompression failed',
        type: 'error',
      });
    } finally {
      setProcessing(false);
    }
  }, [input, decompressFormat, processing, setOutput, setStats, setStatusMsg, setProcessing]);

  return { runCompress, handleDecompress };
}
