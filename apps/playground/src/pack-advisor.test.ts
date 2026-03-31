import { describe, expect, it } from 'vitest';
import { createTablePackPlan } from './pack-advisor';

describe('createTablePackPlan', () => {
  it('creates CSV and YAML variants for top-level JSON arrays', () => {
    const plan = createTablePackPlan(
      JSON.stringify(
        [
          { orderId: 'A-1001', region: 'EMEA', amount: 1299.5, status: 'won' },
          { orderId: 'A-1002', region: 'NA', amount: 899, status: 'pending' },
        ],
        null,
        2,
      ),
      'json',
    );

    expect(plan?.profile.sourceFormat).toBe('json');
    expect(plan?.variants.map((variant) => variant.id)).toEqual(['layout-csv', 'layout-yaml']);
    expect(plan?.variants[0]?.text).toContain('orderId,region,amount,status');
  });

  it('creates JSON and YAML variants for CSV input', () => {
    const plan = createTablePackPlan(
      ['order_id,region,rep,status', 'A-1001,EMEA,Alice,won', 'A-1002,NA,Bob,pending'].join('\n'),
      'csv',
    );

    expect(plan?.profile.sourceFormat).toBe('csv');
    expect(plan?.variants.map((variant) => variant.id)).toEqual(['layout-json', 'layout-yaml']);
    expect(plan?.variants[0]?.text).toContain('"order_id": "A-1001"');
  });

  it('refuses wrapped JSON objects so the default lossless path stays explicit', () => {
    const plan = createTablePackPlan(
      JSON.stringify(
        {
          users: [
            { name: 'Alice', role: 'platform', region: 'eu-central-1' },
            { name: 'Bob', role: 'product', region: 'us-east-1' },
          ],
        },
        null,
        2,
      ),
      'json',
    );

    expect(plan).toBeNull();
  });
});
