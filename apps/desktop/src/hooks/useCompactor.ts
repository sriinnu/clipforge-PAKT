import { compress, countTokens, decompress, detect } from '@yugenlab/pakt';
import type { PaktFormat, PaktOptions } from '@yugenlab/pakt';
import { useCallback, useState } from 'react';

export interface CompactorState {
  input: string;
  output: string;
  format: string;
  originalTokens: number;
  compressedTokens: number;
  savings: number;
  isProcessing: boolean;
  setInput: (text: string) => void;
  compress: (options?: Partial<PaktOptions>) => void;
  decompress: (format?: PaktFormat) => void;
}

export function useCompactor(): CompactorState {
  const [input, setInputRaw] = useState('');
  const [output, setOutput] = useState('');
  const [format, setFormat] = useState('text');
  const [originalTokens, setOriginalTokens] = useState(0);
  const [compressedTokens, setCompressedTokens] = useState(0);
  const [savings, setSavings] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

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

  const doCompress = useCallback(
    (options?: Partial<PaktOptions>) => {
      if (!input.trim()) return;
      setIsProcessing(true);
      try {
        const result = compress(input, options);
        setOutput(result.compressed);
        setOriginalTokens(result.originalTokens);
        setCompressedTokens(result.compressedTokens);
        setSavings(result.savings.totalPercent);
        setFormat(result.detectedFormat);
      } catch (err) {
        setOutput(`Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsProcessing(false);
      }
    },
    [input],
  );

  const doDecompress = useCallback(
    (outputFormat?: PaktFormat) => {
      if (!input.trim()) return;
      setIsProcessing(true);
      try {
        const result = decompress(input, outputFormat);
        setOutput(result.text);
        const origTokens = countTokens(input);
        const outTokens = countTokens(result.text);
        setOriginalTokens(origTokens);
        setCompressedTokens(outTokens);
        setSavings(origTokens > 0 ? Math.round(((origTokens - outTokens) / origTokens) * 100) : 0);
        setFormat(result.originalFormat);
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
