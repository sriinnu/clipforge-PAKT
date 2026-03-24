import {
  PAKT_LAYER_PROFILES,
  createProfiledPaktOptions,
  type PaktFormat,
  type PaktLayerProfile,
  type PaktLayerProfileId,
} from '@sriinnu/pakt';
import { createTablePackPlan } from './pack-advisor';

const MIXED_MARKER = '<!-- PAKT:';

type Action = 'compress' | null;
type PaktModule = typeof import('@sriinnu/pakt');

type ComparisonItemId =
  | 'original'
  | PaktLayerProfileId
  | 'layout-csv'
  | 'layout-json'
  | 'layout-yaml';

export interface CompressionConfig {
  profileId: PaktLayerProfileId;
  semanticBudget?: number;
}

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
  id: ComparisonItemId;
  label: string;
  tokens: number;
  percent: string;
  delta: string;
  note: string;
  text: string;
  kind: 'source' | 'profile' | 'table';
  packedOutput: string | null;
  profileId?: PaktLayerProfileId;
  reversible?: boolean;
}

export interface ComparisonRecommendation {
  title: string;
  body: string;
  winnerId: ComparisonItem['id'];
  winnerLabel: string;
  tokens: number;
  packedOutput: string | null;
}

export interface ComparisonState {
  status: 'idle' | 'loading' | 'ready';
  items: readonly ComparisonItem[] | null;
  error: string | null;
  recommendation: ComparisonRecommendation | null;
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

function hasSemanticBudget(config: CompressionConfig): boolean {
  return Number.isInteger(config.semanticBudget) && (config.semanticBudget ?? 0) > 0;
}

function getComparisonProfiles(semanticBudget?: number): readonly PaktLayerProfile[] {
  const hasBudget = Number.isInteger(semanticBudget) && semanticBudget !== undefined && semanticBudget > 0;
  return PAKT_LAYER_PROFILES.filter(
    (profile) => !profile.requiresSemanticBudget || hasBudget,
  );
}

function getProfileNote(profile: PaktLayerProfile, semanticBudget?: number): string {
  if (!profile.requiresSemanticBudget) {
    return profile.description;
  }

  return `${profile.description} Current semantic budget: ${semanticBudget} tokens.`;
}

async function loadPakt(): Promise<PaktModule> {
  paktModulePromise ??= import('@sriinnu/pakt');
  return paktModulePromise;
}

function buildCompressionOptions(format: PaktFormat, config: CompressionConfig) {
  return createProfiledPaktOptions(config.profileId, {
    fromFormat: format,
    ...(hasSemanticBudget(config) ? { semanticBudget: config.semanticBudget } : {}),
  });
}

async function compressDocument(
  input: string,
  format: PaktFormat,
  config: CompressionConfig,
): Promise<{ compressed: string; originalTokens: number; compressedTokens: number; reversible: boolean }> {
  const { compress, compressMixed } = await loadPakt();
  const options = buildCompressionOptions(format, config);
  const result = isMixedFormat(format)
    ? compressMixed(input, options)
    : compress(input, options);

  return {
    compressed: result.compressed,
    originalTokens: result.originalTokens,
    compressedTokens: result.compressedTokens,
    reversible: result.reversible,
  };
}

async function decompressDocument(input: string, format: PaktFormat): Promise<string> {
  const { decompress, decompressMixed } = await loadPakt();
  return input.includes(MIXED_MARKER) ? decompressMixed(input) : decompress(input, format).text;
}

export async function preloadPakt(): Promise<void> {
  await loadPakt();
}

export async function analyzePreview(
  input: string,
  liveCompress: boolean,
  config: CompressionConfig,
): Promise<PreviewResult> {
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
    const result = await compressDocument(input, detected.format, config);
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

export async function compressSource(
  input: string,
  config: CompressionConfig,
): Promise<CompressionResult> {
  const { countTokens, detect } = await loadPakt();
  const detected = detect(input);
  const inputTokens = countTokens(input);
  const packedInputDetected = detected.format === 'pakt' || input.includes(MIXED_MARKER);

  if (packedInputDetected) {
    throw new Error('Input already looks like PAKT. Use Restore from PAKT instead.');
  }

  const result = await compressDocument(input, detected.format, config);
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

export async function computeComparison(
  input: string,
  semanticBudget?: number,
): Promise<ComparisonState> {
  if (!input.trim()) {
    return { status: 'idle', items: null, error: null, recommendation: null };
  }

  try {
    const { countTokens, detect } = await loadPakt();
    const detected = detect(input);
    const packedInputDetected = detected.format === 'pakt' || input.includes(MIXED_MARKER);

    if (packedInputDetected) {
      return { status: 'ready', items: null, error: null, recommendation: null };
    }

    const originalTokens = countTokens(input);
    const items: ComparisonItem[] = [
      {
        id: 'original',
        label: 'Original',
        tokens: originalTokens,
        percent: 'Baseline',
        delta: '0 tokens saved',
        note: 'Raw source payload before any structural rewrite.',
        text: input,
        kind: 'source',
        packedOutput: null,
      },
    ];
    const packedCandidates: ComparisonItem[] = [];

    for (const profile of getComparisonProfiles(semanticBudget)) {
      const result = await compressDocument(input, detected.format, {
        profileId: profile.id,
        ...(profile.requiresSemanticBudget ? { semanticBudget } : {}),
      });

      const item: ComparisonItem = {
        id: profile.id,
        label: `${profile.label} (${profile.shortLabel})`,
        tokens: result.compressedTokens,
        percent: `${formatPercent(originalTokens, result.compressedTokens)} vs original`,
        delta: formatDelta(originalTokens, result.compressedTokens),
        note: getProfileNote(profile, semanticBudget),
        text: result.compressed,
        kind: 'profile',
        packedOutput: result.compressed,
        profileId: profile.id,
        reversible: result.reversible,
      };

      items.push(item);
      packedCandidates.push(item);
    }

    const tablePlan = createTablePackPlan(input, detected.format);
    if (tablePlan) {
      for (const variant of tablePlan.variants) {
        const result = await compressDocument(variant.text, variant.format, { profileId: 'standard' });
        const item: ComparisonItem = {
          id: variant.id,
          label: `${variant.label} + Standard PAKT`,
          tokens: result.compressedTokens,
          percent: `${formatPercent(originalTokens, result.compressedTokens)} vs original`,
          delta: formatDelta(originalTokens, result.compressedTokens),
          note: `${tablePlan.profile.summary} ${variant.note}`,
          text: result.compressed,
          kind: 'table',
          packedOutput: result.compressed,
        };
        items.push(item);
        packedCandidates.push(item);
      }
    }

    const winner = [...items].reduce((best, item) => (item.tokens < best.tokens ? item : best));
    const recommendation = buildRecommendation(originalTokens, winner, tablePlan);

    return {
      status: 'ready',
      items,
      error: null,
      recommendation,
    };
  } catch (error) {
    return {
      status: 'ready',
      items: null,
      error: getErrorMessage(error),
      recommendation: null,
    };
  }
}

function buildRecommendation(
  originalTokens: number,
  winner: ComparisonItem,
  tablePlan: ReturnType<typeof createTablePackPlan>,
): ComparisonRecommendation {
  if (winner.id === 'original') {
    return {
      title: 'Keep the raw payload',
      body: tablePlan
        ? `${tablePlan.profile.summary} None of the packed variants beat the source token count, so auto-pack backs off for this input.`
        : 'None of the available packed variants beat the source token count, so the cleanest move is to leave the payload as-is.',
      winnerId: winner.id,
      winnerLabel: winner.label,
      tokens: winner.tokens,
      packedOutput: null,
    };
  }

  if (winner.kind === 'table') {
    return {
      title: `Use ${winner.label}`,
      body: `${tablePlan?.profile.summary ?? 'Tabular payload detected.'} This table-aware layout is the smallest packed output here. Restoring it returns the projected table layout, not the original wrapper schema.`,
      winnerId: winner.id,
      winnerLabel: winner.label,
      tokens: winner.tokens,
      packedOutput: winner.packedOutput,
    };
  }

  const savings = formatPercent(originalTokens, winner.tokens);
  if (winner.profileId === 'structure') {
    return {
      title: 'Use structure only',
      body: `Dictionary aliases do not help this payload enough to justify the overhead. Structural-only packing is the smallest result here at ${savings} vs the original source.`,
      winnerId: winner.id,
      winnerLabel: winner.label,
      tokens: winner.tokens,
      packedOutput: winner.packedOutput,
    };
  }

  if (winner.profileId === 'tokenizer') {
    return {
      title: 'Use tokenizer-aware PAKT',
      body: `Tokenizer-aware packing wins here at ${savings} vs the original source while staying reversible. This is the closest app-surface match to the full lossless engine.`,
      winnerId: winner.id,
      winnerLabel: winner.label,
      tokens: winner.tokens,
      packedOutput: winner.packedOutput,
    };
  }

  if (winner.profileId === 'semantic') {
    return {
      title: 'Use semantic PAKT carefully',
      body: `Budgeted semantic packing is the smallest output here at ${savings} vs the original source, but it is lossy. Use this when token pressure matters more than exact round-trip fidelity.`,
      winnerId: winner.id,
      winnerLabel: winner.label,
      tokens: winner.tokens,
      packedOutput: winner.packedOutput,
    };
  }

  return {
    title: 'Use standard PAKT',
    body: tablePlan
      ? `${tablePlan.profile.summary} Standard full PAKT still wins, so auto-pack falls back to the normal reversible path at ${savings} vs the original source.`
      : `Standard full PAKT is the smallest reversible output here at ${savings} vs the original source.`,
    winnerId: winner.id,
    winnerLabel: winner.label,
    tokens: winner.tokens,
    packedOutput: winner.packedOutput,
  };
}
