import type { PaktFormat, PaktOptions } from '@sriinnu/pakt';

const MIXED_MARKER = '<!-- PAKT:';

type Action = 'compress' | null;
type PaktModule = typeof import('@sriinnu/pakt');

export interface PreviewResult {
  detectedFormat: PaktFormat;
  inputTokens: number;
  packedInputDetected: boolean;
  output: string;
  outputTokens: number;
  error: string | null;
  lastAction: Action;
}

export interface ComparisonItem {
  id: 'original' | 'l1' | 'full';
  label: string;
  tokens: number;
  percent: string;
  delta: string;
  note: string;
  text: string;
}

export interface ComparisonState {
  status: 'idle' | 'loading' | 'ready';
  items: readonly ComparisonItem[] | null;
  error: string | null;
}

export interface CompressionResult {
  detectedFormat: PaktFormat;
  inputTokens: number;
  packedInputDetected: boolean;
  output: string;
  outputTokens: number;
}

export interface DecompressionResult {
  detectedFormat: PaktFormat;
  inputTokens: number;
  packedInputDetected: boolean;
  output: string;
  outputTokens: number;
}

let paktModulePromise: Promise<PaktModule> | null = null;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Playground runtime failed';
}

function formatDelta(before: number, after: number): string {
  const delta = before - after;
  if (delta === 0) return 'No token change';
  const label = delta > 0 ? 'saved' : 'expanded';
  return `${Math.abs(delta).toLocaleString()} tokens ${label}`;
}

function formatPercent(before: number, after: number): string {
  if (before <= 0) return '0%';
  const percent = Math.round(((before - after) / before) * 100);
  return `${percent}%`;
}

function isMixedFormat(format: PaktFormat): boolean {
  return format === 'markdown' || format === 'text';
}

async function loadPakt(): Promise<PaktModule> {
  paktModulePromise ??= import('@sriinnu/pakt');
  return paktModulePromise;
}

async function compressDocument(
  input: string,
  format: PaktFormat,
  options?: Partial<PaktOptions>,
): Promise<{ compressed: string; originalTokens: number; compressedTokens: number }> {
  const { compress, compressMixed } = await loadPakt();
  const result = isMixedFormat(format)
    ? compressMixed(input, { ...options, fromFormat: format })
    : compress(input, { ...options, fromFormat: format });

  return {
    compressed: result.compressed,
    originalTokens: result.originalTokens,
    compressedTokens: result.compressedTokens,
  };
}

async function decompressDocument(input: string, format: PaktFormat): Promise<string> {
  const { decompress, decompressMixed } = await loadPakt();
  return input.includes(MIXED_MARKER) ? decompressMixed(input) : decompress(input, format).text;
}

export async function preloadPakt(): Promise<void> {
  await loadPakt();
}

export async function analyzePreview(input: string, liveCompress: boolean): Promise<PreviewResult> {
  if (!input.trim()) {
    return {
      detectedFormat: 'text',
      inputTokens: 0,
      packedInputDetected: false,
      output: '',
      outputTokens: 0,
      error: null,
      lastAction: null,
    };
  }

  const { countTokens, detect } = await loadPakt();
  const detected = detect(input);
  const inputTokens = countTokens(input);
  const packedInputDetected = detected.format === 'pakt' || input.includes(MIXED_MARKER);

  if (!liveCompress || packedInputDetected) {
    return {
      detectedFormat: detected.format,
      inputTokens,
      packedInputDetected,
      output: '',
      outputTokens: 0,
      error: null,
      lastAction: null,
    };
  }

  try {
    const result = await compressDocument(input, detected.format);
    return {
      detectedFormat: detected.format,
      inputTokens,
      packedInputDetected,
      output: result.compressed,
      outputTokens: result.compressedTokens,
      error: null,
      lastAction: 'compress',
    };
  } catch (error) {
    return {
      detectedFormat: detected.format,
      inputTokens,
      packedInputDetected,
      output: '',
      outputTokens: 0,
      error: getErrorMessage(error),
      lastAction: 'compress',
    };
  }
}

export async function compressSource(input: string): Promise<CompressionResult> {
  const { countTokens, detect } = await loadPakt();
  const detected = detect(input);
  const inputTokens = countTokens(input);
  const packedInputDetected = detected.format === 'pakt' || input.includes(MIXED_MARKER);

  if (packedInputDetected) {
    throw new Error('Input already looks like PAKT. Use Restore from PAKT instead.');
  }

  const result = await compressDocument(input, detected.format);
  return {
    detectedFormat: detected.format,
    inputTokens,
    packedInputDetected,
    output: result.compressed,
    outputTokens: result.compressedTokens,
  };
}

export async function decompressSource(
  input: string,
  format: PaktFormat,
): Promise<DecompressionResult> {
  const { countTokens, detect } = await loadPakt();
  const detected = detect(input);
  const output = await decompressDocument(input, format);
  return {
    detectedFormat: detected.format,
    inputTokens: countTokens(input),
    packedInputDetected: detected.format === 'pakt' || input.includes(MIXED_MARKER),
    output,
    outputTokens: countTokens(output),
  };
}

export async function computeComparison(input: string): Promise<ComparisonState> {
  if (!input.trim()) {
    return { status: 'idle', items: null, error: null };
  }

  try {
    const { countTokens, detect } = await loadPakt();
    const detected = detect(input);
    const packedInputDetected = detected.format === 'pakt' || input.includes(MIXED_MARKER);

    if (packedInputDetected) {
      return { status: 'ready', items: null, error: null };
    }

    const originalTokens = countTokens(input);
    const l1Only = await compressDocument(input, detected.format, {
      layers: {
        structural: true,
        dictionary: false,
        tokenizerAware: false,
        semantic: false,
      },
    });
    const fullPakt = await compressDocument(input, detected.format, {
      layers: {
        structural: true,
        dictionary: true,
        tokenizerAware: false,
        semantic: false,
      },
    });

    return {
      status: 'ready',
      items: [
        {
          id: 'original',
          label: 'Original',
          tokens: originalTokens,
          percent: 'Baseline',
          delta: '0 tokens saved',
          note: 'Raw source payload before any structural rewrite.',
          text: input,
        },
        {
          id: 'l1',
          label: 'Structural baseline (TOON-like)',
          tokens: l1Only.compressedTokens,
          percent: `${formatPercent(originalTokens, l1Only.compressedTokens)} vs original`,
          delta: formatDelta(originalTokens, l1Only.compressedTokens),
          note: 'Structural rewrite only. Closest baseline to TOON-style compact syntax, without implying a first-party TOON encoder.',
          text: l1Only.compressed,
        },
        {
          id: 'full',
          label: 'PAKT full',
          tokens: fullPakt.compressedTokens,
          percent: `${formatPercent(originalTokens, fullPakt.compressedTokens)} vs original`,
          delta: formatDelta(originalTokens, fullPakt.compressedTokens),
          note: 'Structural rewrite plus dictionary aliases for repeated keys and values.',
          text: fullPakt.compressed,
        },
      ] as const,
      error: null,
    };
  } catch (error) {
    return {
      status: 'ready',
      items: null,
      error: getErrorMessage(error),
    };
  }
}
