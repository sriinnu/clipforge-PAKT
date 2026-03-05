/**
 * @module useCompactor
 * React hook that wires clipboard text to the PAKT compression engine.
 *
 * Uses `compressMixed` for text/markdown inputs (detects embedded structured
 * blocks and compresses them individually) and plain `compress` for pure
 * structured formats (json, yaml, csv, pakt).
 *
 * Decompression auto-detects PAKT markers (`<!-- PAKT:... -->`) and routes
 * to `decompressMixed` when present, falling back to plain `decompress`.
 */

import {
  compress,
  compressMixed,
  countTokens,
  decompress,
  decompressMixed,
  detect,
} from '@sriinnu/pakt';
import type { PaktFormat, PaktOptions } from '@sriinnu/pakt';
import { useCallback, useState } from 'react';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/** State shape returned by {@link useCompactor}. */
export interface CompactorState {
  /** Current raw input text. */
  input: string;
  /** Compression/decompression output. */
  output: string;
  /** Detected or resolved format label. */
  format: string;
  /** Token count before processing. */
  originalTokens: number;
  /** Token count after processing. */
  compressedTokens: number;
  /** Savings percentage (0-100). */
  savings: number;
  /** True while a compress/decompress operation is running. */
  isProcessing: boolean;
  /** Set the input text and auto-detect its format. */
  setInput: (text: string) => void;
  /** Run compression with optional layer/format overrides. */
  compress: (options?: Partial<PaktOptions>) => void;
  /** Run decompression, optionally forcing an output format. */
  decompress: (format?: PaktFormat) => void;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/** Formats that contain only structured data (no mixed prose). */
const STRUCTURED_FORMATS = new Set<PaktFormat>(['json', 'yaml', 'csv', 'pakt']);

/** Regex to detect PAKT markers in mixed-content documents. */
const PAKT_MARKER_RE = /<!-- PAKT:\w+ -->/;

/**
 * Determine whether `fmt` is a structured-only format.
 * Text and markdown may contain embedded structured blocks, so
 * they are routed through the mixed-content pipeline instead.
 */
function isStructuredFormat(fmt: PaktFormat | string): boolean {
  return STRUCTURED_FORMATS.has(fmt as PaktFormat);
}

/**
 * Calculate savings percentage from two token counts.
 * Returns 0 when `original` is zero to avoid division errors.
 */
function calcSavings(original: number, compressed: number): number {
  return original > 0 ? Math.round(((original - compressed) / original) * 100) : 0;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook that provides compress/decompress actions wired to pakt-core.
 *
 * - Text/markdown inputs use `compressMixed` (preserves prose, compresses
 *   embedded structured blocks individually).
 * - Structured inputs (json, yaml, csv) use plain `compress`.
 * - Decompression detects PAKT markers and routes to `decompressMixed`
 *   when present, otherwise falls back to plain `decompress`.
 */
export function useCompactor(): CompactorState {
  const [input, setInputRaw] = useState('');
  const [output, setOutput] = useState('');
  const [format, setFormat] = useState('text');
  const [originalTokens, setOriginalTokens] = useState(0);
  const [compressedTokens, setCompressedTokens] = useState(0);
  const [savings, setSavings] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  /** Set input text and run auto-detection to update the format badge. */
  const setInput = useCallback((text: string) => {
    setInputRaw(text);
    if (text.trim()) {
      try {
        const detected = detect(text);
        setFormat(detected.format);
      } catch {
        setFormat('text');
      }
    } else {
      setFormat('text');
    }
  }, []);

  /**
   * Compress the current input.
   *
   * Routes to `compressMixed` for text/markdown (preserves prose, compresses
   * embedded blocks) or plain `compress` for structured formats.
   */
  const doCompress = useCallback(
    (options?: Partial<PaktOptions>) => {
      if (!input.trim()) return;
      setIsProcessing(true);
      try {
        const detected = detect(input);
        const effectiveFormat = options?.fromFormat ?? detected.format;

        if (isStructuredFormat(effectiveFormat)) {
          // Pure structured data -- use direct compress pipeline
          const result = compress(input, options);
          setOutput(result.compressed);
          setOriginalTokens(result.originalTokens);
          setCompressedTokens(result.compressedTokens);
          setSavings(result.savings.totalPercent);
          setFormat(result.detectedFormat);
        } else {
          // Text/markdown -- use mixed-content pipeline
          const result = compressMixed(input, options);
          setOutput(result.compressed);
          setOriginalTokens(result.originalTokens);
          setCompressedTokens(result.compressedTokens);
          setSavings(result.savings.totalPercent);
          setFormat(effectiveFormat);
        }
      } catch (err) {
        setOutput(`Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsProcessing(false);
      }
    },
    [input],
  );

  /**
   * Decompress the current input.
   *
   * If the input contains PAKT markers (`<!-- PAKT:... -->`), routes to
   * `decompressMixed` which restores each embedded block. Otherwise uses
   * the standard `decompress` for plain PAKT documents.
   */
  const doDecompress = useCallback(
    (outputFormat?: PaktFormat) => {
      if (!input.trim()) return;
      setIsProcessing(true);
      try {
        const origTokens = countTokens(input);

        if (PAKT_MARKER_RE.test(input)) {
          // Mixed content with PAKT markers -- restore blocks in-place.
          // On decompress: input is the smaller PAKT form, output is the larger
          // original. Swap args so savings stays positive (compressed < original).
          const restored = decompressMixed(input);
          const outTokens = countTokens(restored);
          setOutput(restored);
          setOriginalTokens(outTokens); // decompressed form = "original"
          setCompressedTokens(origTokens); // PAKT form = "compressed"
          setSavings(calcSavings(outTokens, origTokens));
          setFormat('text');
        } else {
          // Plain PAKT document -- standard decompress
          const result = decompress(input, outputFormat);
          const outTokens = countTokens(result.text);
          setOutput(result.text);
          setOriginalTokens(outTokens); // decompressed form = "original"
          setCompressedTokens(origTokens); // PAKT form = "compressed"
          setSavings(calcSavings(outTokens, origTokens));
          setFormat(result.originalFormat);
        }
      } catch (err) {
        setOutput(`Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsProcessing(false);
      }
    },
    [input],
  );

  return {
    input,
    output,
    format,
    originalTokens,
    compressedTokens,
    savings,
    isProcessing,
    setInput,
    compress: doCompress,
    decompress: doDecompress,
  };
}
