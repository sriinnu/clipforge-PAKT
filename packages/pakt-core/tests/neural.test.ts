import { describe, expect, it } from 'vitest';
import { type NeuralCompressor, combineWithGuarantee } from '../src/neural/index.js';

const MODEL = 'gpt-4o';

/** Build a compressor from a function (or a fixed return). */
function compressorOf(
  name: string,
  fn: (input: string) => Promise<string | null> | string | null,
): NeuralCompressor {
  return { name, compress: async (input) => fn(input) };
}

// A baseline long enough that a shorter candidate clearly wins on tokens.
const ORIGINAL =
  'The quarterly revenue report shows growth across every region and product line for the period.';
const DETERMINISTIC = ORIGINAL; // pretend PAKT could not shrink this prose

describe('combineWithGuarantee: non-regression', () => {
  it('uses the neural candidate when it is smaller and accepted', async () => {
    const neural = compressorOf('tiny', () => 'revenue grew everywhere');
    const r = await combineWithGuarantee(ORIGINAL, neural, {
      model: MODEL,
      deterministic: DETERMINISTIC,
    });
    expect(r.source).toBe('neural');
    expect(r.text).toBe('revenue grew everywhere');
    expect(r.savedVsDeterministic).toBeGreaterThan(0);
    expect(r.tokens).toBeLessThanOrEqual(r.deterministicTokens);
  });

  it('falls back when the neural candidate is larger (no gain)', async () => {
    const neural = compressorOf('bloat', (i) => `${i} ${i} ${i}`);
    const r = await combineWithGuarantee(ORIGINAL, neural, {
      model: MODEL,
      deterministic: DETERMINISTIC,
    });
    expect(r.source).toBe('deterministic');
    expect(r.rejectedReason).toBe('no-gain');
    expect(r.tokens).toBe(r.deterministicTokens);
  });

  it('falls back when the compressor abstains (null)', async () => {
    const neural = compressorOf('shy', () => null);
    const r = await combineWithGuarantee(ORIGINAL, neural, { model: MODEL });
    expect(r.source).toBe('deterministic');
    expect(r.rejectedReason).toBe('abstained');
    expect(r.neuralTokens).toBeNull();
  });

  it('falls back when the compressor throws (never breaks the pipeline)', async () => {
    const neural: NeuralCompressor = {
      name: 'flaky',
      compress: async () => {
        throw new Error('model timeout');
      },
    };
    const r = await combineWithGuarantee(ORIGINAL, neural, { model: MODEL });
    expect(r.source).toBe('deterministic');
    expect(r.rejectedReason).toBe('error');
  });

  it('falls back when the fidelity gate rejects the candidate', async () => {
    // Candidate is smaller but drops a required token; accept() rejects it.
    const neural = compressorOf('lossy', () => 'numbers went up');
    const r = await combineWithGuarantee(ORIGINAL, neural, {
      model: MODEL,
      deterministic: DETERMINISTIC,
      accept: (_orig, cand) => cand.includes('revenue'),
    });
    expect(r.source).toBe('deterministic');
    expect(r.rejectedReason).toBe('rejected-by-accept');
  });

  it('accepts when the fidelity gate passes', async () => {
    const neural = compressorOf('faithful', () => 'revenue up');
    const r = await combineWithGuarantee(ORIGINAL, neural, {
      model: MODEL,
      deterministic: DETERMINISTIC,
      accept: (_orig, cand) => cand.includes('revenue'),
    });
    expect(r.source).toBe('neural');
  });

  it('respects minGain — a marginal win is rejected', async () => {
    // Drop exactly one word; with a high minGain it should not qualify.
    const oneShorter = ORIGINAL.replace(' period.', '.');
    const neural = compressorOf('marginal', () => oneShorter);
    const r = await combineWithGuarantee(ORIGINAL, neural, {
      model: MODEL,
      deterministic: DETERMINISTIC,
      minGain: 50,
    });
    expect(r.source).toBe('deterministic');
    expect(r.rejectedReason).toBe('no-gain');
  });

  it('guarantee holds for an adversarial compressor (property check)', async () => {
    const adversary = compressorOf('adversary', (i) => i.repeat(10));
    const r = await combineWithGuarantee(ORIGINAL, adversary, {
      model: MODEL,
      deterministic: DETERMINISTIC,
    });
    // Core invariant: result is never larger than the deterministic baseline.
    expect(r.tokens).toBeLessThanOrEqual(r.deterministicTokens);
  });
});
