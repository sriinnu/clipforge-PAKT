import { describe, expect, it } from 'vitest';
import { spillPreview } from './pakt-service';
import { SPILL_SAMPLE } from './spill-samples';

describe('spillPreview (real core spill)', () => {
  it('spills the sample build log and keeps its failing tail', async () => {
    const r = await spillPreview(SPILL_SAMPLE, {
      thresholdTokens: 1000,
      headLines: 15,
      tailLines: 15,
    });
    expect(r.spilled).toBe(true);
    expect(r.id).toMatch(/^sp_[0-9a-f]{16}$/);
    expect(r.tokens).toBeLessThan(r.originalTokens / 4);
    expect(r.content).toContain('$ pnpm -r run build');
    expect(r.content).toContain('error TS2322');
    expect(r.content).toContain('pakt_recall');
  });
});
