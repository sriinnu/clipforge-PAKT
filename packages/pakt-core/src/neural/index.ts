/**
 * @module neural
 * Opt-in neural compression tier with a non-regression guarantee.
 *
 * PAKT's lossless L1–L3 layers are deterministic and model-free by design.
 * Neural prompt compressors (LLMLingua-family, learned summarizers) can reach
 * higher ratios, but they are lossy, model-dependent, and can degrade quality
 * unpredictably — exactly the properties PAKT exists to avoid.
 *
 * This module lets a caller bolt a neural compressor onto PAKT **without
 * inheriting that risk**, via a test-time-steering / weighted-product-of-experts
 * construction (Zhang et al. 2025, hf.co/papers/2511.10660): combine the
 * deterministic baseline with a neural candidate and keep the neural one *only*
 * when it is both smaller AND passes a caller-supplied fidelity gate. Otherwise
 * fall back to deterministic.
 *
 * ### Guarantee
 * For any compressor (even a broken or adversarial one):
 *
 *   tokens(result) ≤ tokens(deterministic baseline)
 *
 * The neural tier can only ever help. There is no bundled model — the caller
 * plugs in whatever they trust (a local model, an API, LLMLingua), so PAKT
 * stays model-free at its core and the neural dependency is entirely opt-in.
 */

import { countTokens } from '../tokens/index.js';

/** Context handed to a {@link NeuralCompressor}. */
export interface NeuralCompressionContext {
  /** Model identifier for token counting. */
  model: string;
}

/**
 * A pluggable neural compressor. Implementations may call any model or service.
 * Return a compressed candidate, or `null` to abstain. Throwing is treated as
 * abstaining — a flaky compressor can never break the pipeline.
 */
export interface NeuralCompressor {
  /** Human-readable name, used in {@link NeuralCombineResult.compressor}. */
  readonly name: string;
  /** Produce a compressed candidate for `input`, or `null` to abstain. */
  compress(input: string, ctx: NeuralCompressionContext): Promise<string | null>;
}

/** Options for {@link combineWithGuarantee}. */
export interface NeuralCombineOptions {
  /** Model identifier for token counting. @default 'gpt-4o' */
  model?: string;
  /**
   * The deterministic baseline to fall back to (e.g. a PAKT-compressed string).
   * When omitted, `input` itself is the baseline.
   */
  deterministic?: string;
  /**
   * Fidelity gate. Return `true` to ACCEPT the neural candidate. Receives the
   * original `input` and the neural `candidate`. The default accepts on the
   * token gate alone — supply this to enforce faithfulness (e.g. check that
   * required entities survive). @default () => true
   */
  accept?: (original: string, candidate: string) => boolean;
  /**
   * Minimum token gain over the deterministic baseline for the neural candidate
   * to be worth its lossy risk. @default 1
   */
  minGain?: number;
}

/** Why a neural candidate was not used. */
export type NeuralRejectReason = 'abstained' | 'error' | 'no-gain' | 'rejected-by-accept';

/** Result of {@link combineWithGuarantee}. */
export interface NeuralCombineResult {
  /** The winning text. Guaranteed to be no larger (in tokens) than the baseline. */
  text: string;
  /** Token count of {@link text}. */
  tokens: number;
  /** Which expert won. */
  source: 'deterministic' | 'neural';
  /** Name of the neural compressor consulted. */
  compressor: string;
  /** Token count of the deterministic baseline. */
  deterministicTokens: number;
  /** Token count of the neural candidate, or `null` if it abstained/errored. */
  neuralTokens: number | null;
  /** Tokens saved versus the deterministic baseline (>= 0). */
  savedVsDeterministic: number;
  /** Present when the neural candidate was not used. */
  rejectedReason?: NeuralRejectReason;
}

/**
 * Combine a deterministic baseline with a neural candidate under the
 * non-regression guarantee: the neural candidate is used only when it is
 * strictly smaller (by at least `minGain` tokens) AND passes `accept`.
 *
 * The returned text is never larger than the deterministic baseline, for any
 * compressor — including one that abstains, throws, returns the input
 * unchanged, or returns something larger.
 *
 * @param input - The original, uncompressed text (passed to `accept`).
 * @param compressor - The neural compressor to consult.
 * @param opts - {@link NeuralCombineOptions}.
 * @returns {@link NeuralCombineResult}
 */
export async function combineWithGuarantee(
  input: string,
  compressor: NeuralCompressor,
  opts: NeuralCombineOptions = {},
): Promise<NeuralCombineResult> {
  const model = opts.model ?? 'gpt-4o';
  const accept = opts.accept ?? (() => true);
  // Clamp to >= 0 so the non-regression invariant (tokens(result) <= baseline)
  // holds unconditionally — a negative minGain would otherwise admit a LARGER
  // candidate.
  const minGain = Math.max(0, opts.minGain ?? 1);
  const deterministic = opts.deterministic ?? input;
  const deterministicTokens = countTokens(deterministic, model);

  const fallback = (
    reason: NeuralRejectReason,
    neuralTokens: number | null,
  ): NeuralCombineResult => ({
    text: deterministic,
    tokens: deterministicTokens,
    source: 'deterministic',
    compressor: compressor.name,
    deterministicTokens,
    neuralTokens,
    savedVsDeterministic: 0,
    rejectedReason: reason,
  });

  let candidate: string | null;
  try {
    candidate = await compressor.compress(input, { model });
  } catch {
    return fallback('error', null);
  }
  if (candidate === null) return fallback('abstained', null);

  const neuralTokens = countTokens(candidate, model);
  // Token gate: must beat the baseline by at least `minGain`.
  if (neuralTokens > deterministicTokens - minGain) return fallback('no-gain', neuralTokens);
  // Fidelity gate: caller decides whether the lossy candidate is acceptable.
  // A throwing `accept` is treated as a rejection — the gate must never be able
  // to break the pipeline (mirrors the compress() guard above).
  let accepted: boolean;
  try {
    accepted = accept(input, candidate);
  } catch {
    return fallback('rejected-by-accept', neuralTokens);
  }
  if (!accepted) return fallback('rejected-by-accept', neuralTokens);

  return {
    text: candidate,
    tokens: neuralTokens,
    source: 'neural',
    compressor: compressor.name,
    deterministicTokens,
    neuralTokens,
    savedVsDeterministic: deterministicTokens - neuralTokens,
  };
}
