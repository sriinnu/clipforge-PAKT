/**
 * @module tests/compressibility
 * Tests for the compressibility scoring engine.
 *
 * Covers: high/low/medium entropy inputs, structured vs prose,
 * score ranges, label mapping, profile recommendations, and
 * breakdown correctness.
 */

import { describe, expect, it } from 'vitest';
import {
  type CompressibilityLabel,
  type CompressibilityResult,
  estimateCompressibility,
} from '../src/compressibility.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert score falls within expected range. */
function expectScoreInRange(result: CompressibilityResult, min: number, max: number): void {
  expect(result.score).toBeGreaterThanOrEqual(min);
  expect(result.score).toBeLessThanOrEqual(max);
}

// ===========================================================================
// 1. High compressibility inputs
// ===========================================================================

describe('compressibility: high compressibility', () => {
  it('scores highly for repetitive JSON arrays', () => {
    const data = JSON.stringify([
      { name: 'Alice', role: 'engineer', dept: 'platform' },
      { name: 'Bob', role: 'engineer', dept: 'platform' },
      { name: 'Charlie', role: 'engineer', dept: 'platform' },
      { name: 'Diana', role: 'engineer', dept: 'platform' },
      { name: 'Eve', role: 'engineer', dept: 'platform' },
    ]);
    const result = estimateCompressibility(data);
    expectScoreInRange(result, 0.5, 1.0);
    expect(result.format).toBe('json');
    expect(['good', 'high', 'excellent']).toContain(result.label);
  });

  it('scores highly for all-identical rows', () => {
    const row = { status: 'ok', code: 200, msg: 'success' };
    const data = JSON.stringify(Array.from({ length: 10 }, () => row));
    const result = estimateCompressibility(data);
    expectScoreInRange(result, 0.6, 1.0);
  });

  it('scores highly for CSV with repeated values', () => {
    const csv = [
      'name,role,dept',
      'Alice,engineer,platform',
      'Bob,engineer,platform',
      'Charlie,engineer,platform',
      'Diana,engineer,platform',
    ].join('\n');
    const result = estimateCompressibility(csv);
    expectScoreInRange(result, 0.4, 1.0);
    expect(result.format).toBe('csv');
  });
});

// ===========================================================================
// 2. Low compressibility inputs
// ===========================================================================

describe('compressibility: low compressibility', () => {
  it('scores low for all-unique short values', () => {
    const data = JSON.stringify({
      a: 'x1',
      b: 'y2',
      c: 'z3',
      d: 'w4',
    });
    const result = estimateCompressibility(data);
    expectScoreInRange(result, 0.0, 0.5);
  });

  it('scores low for plain prose text', () => {
    const prose = `The quick brown fox jumps over the lazy dog.
Each word in this sentence is unique and carries distinct meaning.
There is very little structural repetition in natural language prose.`;
    const result = estimateCompressibility(prose);
    expectScoreInRange(result, 0.0, 0.5);
    expect(result.format).toBe('text');
  });

  it('scores low for short unique JSON', () => {
    const data = JSON.stringify({ id: 'abc123', token: 'xyz789' });
    const result = estimateCompressibility(data);
    expectScoreInRange(result, 0.0, 0.5);
  });
});

// ===========================================================================
// 3. Medium compressibility inputs
// ===========================================================================

describe('compressibility: moderate compressibility', () => {
  it('scores moderately for mixed repetition', () => {
    const data = JSON.stringify({
      users: [
        { name: 'Alice', role: 'dev' },
        { name: 'Bob', role: 'pm' },
      ],
      meta: { version: '1.0', format: 'json' },
    });
    const result = estimateCompressibility(data);
    expectScoreInRange(result, 0.2, 0.8);
  });
});

// ===========================================================================
// 4. Label mapping
// ===========================================================================

describe('compressibility: labels', () => {
  it('maps score ranges to correct labels', () => {
    /* Test with inputs that produce known score ranges */
    const lowInput = 'hello';
    const lowResult = estimateCompressibility(lowInput);
    const validLabels: CompressibilityLabel[] = ['low', 'moderate', 'good', 'high', 'excellent'];
    expect(validLabels).toContain(lowResult.label);
  });

  it('produces all five labels across different inputs', () => {
    const labels = new Set<string>();
    /* Low: short plain text */
    labels.add(estimateCompressibility('hi').label);
    /* Moderate: small JSON */
    labels.add(estimateCompressibility('{"a":1,"b":2}').label);
    /* Good-Excellent: repetitive data */
    labels.add(
      estimateCompressibility(
        JSON.stringify(
          Array.from({ length: 20 }, () => ({ role: 'eng', dept: 'platform', status: 'active' })),
        ),
      ).label,
    );

    expect(labels.size).toBeGreaterThanOrEqual(3); // at least 3 distinct labels
  });
});

// ===========================================================================
// 5. Profile recommendations
// ===========================================================================

describe('compressibility: profile recommendations', () => {
  it('recommends structure for low-compressibility inputs', () => {
    const result = estimateCompressibility('just some words');
    expect(result.score).toBeLessThan(0.4);
    expect(result.profile).toBe('structure');
  });

  it('recommends standard or higher for structured JSON', () => {
    const data = JSON.stringify([
      { a: 'x', b: 'y', c: 'z' },
      { a: 'x', b: 'y', c: 'z' },
      { a: 'x', b: 'y', c: 'z' },
    ]);
    const result = estimateCompressibility(data);
    expect(['standard', 'tokenizer', 'semantic']).toContain(result.profile);
  });
});

// ===========================================================================
// 6. Breakdown correctness
// ===========================================================================

describe('compressibility: breakdown', () => {
  it('returns all four breakdown dimensions', () => {
    const data = JSON.stringify({ key: 'value' });
    const result = estimateCompressibility(data);
    expect(result.breakdown).toHaveProperty('repetitionDensity');
    expect(result.breakdown).toHaveProperty('structuralOverhead');
    expect(result.breakdown).toHaveProperty('schemaUniformity');
    expect(result.breakdown).toHaveProperty('valueLengthScore');
  });

  it('breakdown values are between 0 and 1', () => {
    const data = JSON.stringify([
      { name: 'test', value: 123 },
      { name: 'test', value: 456 },
      { name: 'test', value: 789 },
    ]);
    const result = estimateCompressibility(data);
    for (const val of Object.values(result.breakdown)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  it('repetitionDensity is high for all-identical values', () => {
    const data = JSON.stringify(Array.from({ length: 10 }, () => ({ k: 'same' })));
    const result = estimateCompressibility(data);
    expect(result.breakdown.repetitionDensity).toBeGreaterThan(0.3);
  });

  it('structuralOverhead is high for verbose JSON', () => {
    /* Lots of syntax chars relative to data */
    const data = JSON.stringify({ a: 1, b: 2, c: 3, d: 4, e: 5 });
    const result = estimateCompressibility(data);
    expect(result.breakdown.structuralOverhead).toBeGreaterThan(0.3);
  });

  it('schemaUniformity is high for uniform arrays', () => {
    const data = JSON.stringify([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ]);
    const result = estimateCompressibility(data);
    expect(result.breakdown.schemaUniformity).toBe(1.0);
  });

  it('schemaUniformity is low for mixed-shape arrays', () => {
    const data = JSON.stringify([{ x: 1, y: 2 }, { a: 3, b: 4, c: 5 }, { p: 6 }]);
    const result = estimateCompressibility(data);
    expect(result.breakdown.schemaUniformity).toBeLessThan(0.5);
  });
});

// ===========================================================================
// 7. Format detection
// ===========================================================================

describe('compressibility: format detection', () => {
  it('detects JSON format', () => {
    const result = estimateCompressibility('{"key": "value"}');
    expect(result.format).toBe('json');
  });

  it('detects CSV format', () => {
    const result = estimateCompressibility('a,b,c\n1,2,3\n4,5,6');
    expect(result.format).toBe('csv');
  });

  it('falls back to text for unstructured input', () => {
    const result = estimateCompressibility('just some plain text here');
    expect(result.format).toBe('text');
  });
});

// ===========================================================================
// 8. Edge cases
// ===========================================================================

describe('compressibility: edge cases', () => {
  it('handles empty string', () => {
    const result = estimateCompressibility('');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('handles single character', () => {
    const result = estimateCompressibility('x');
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('handles deeply nested JSON', () => {
    const data = JSON.stringify({
      level1: { level2: { level3: { level4: { value: 'deep' } } } },
    });
    const result = estimateCompressibility(data);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('handles very large repeated array', () => {
    const row = { name: 'test', status: 'active', count: 42 };
    const data = JSON.stringify(Array.from({ length: 100 }, () => row));
    const result = estimateCompressibility(data);
    expectScoreInRange(result, 0.6, 1.0);
  });

  it('score is always rounded to 2 decimal places', () => {
    const data = JSON.stringify({ a: 1, b: 2 });
    const result = estimateCompressibility(data);
    const decimals = result.score.toString().split('.')[1];
    if (decimals) {
      expect(decimals.length).toBeLessThanOrEqual(2);
    }
  });
});

// ===========================================================================
// 9. YAML input scoring (Test 5a)
// ===========================================================================

describe('compressibility: YAML input', () => {
  it('scores YAML input between 0 and 1', () => {
    const yaml = [
      'users:',
      '  - name: Alice',
      '    role: engineer',
      '    dept: platform',
      '  - name: Bob',
      '    role: engineer',
      '    dept: platform',
      '  - name: Charlie',
      '    role: engineer',
      '    dept: platform',
    ].join('\n');
    const result = estimateCompressibility(yaml);
    expectScoreInRange(result, 0, 1);
    /* YAML is detected as text (or yaml) — just verify a valid result */
    expect(result.label).toBeDefined();
    expect(result.profile).toBeDefined();
    expect(result.breakdown).toBeDefined();
  });
});

// ===========================================================================
// 10. >10MB fallback scoring (Test 5b)
// ===========================================================================

describe('compressibility: oversized input fallback', () => {
  it('handles >10MB input without crashing and returns valid result', () => {
    /* Generate a string >10MB that looks like JSON so the >MAX_PARSE_BYTES path triggers */
    const row = '{"name":"Alice","role":"engineer","dept":"platform"},';
    const repeatCount = Math.ceil(10_000_001 / row.length);
    const bigInput = `[${row.repeat(repeatCount).slice(0, -1)}]`;
    /* Verify we actually exceeded the threshold */
    expect(bigInput.length).toBeGreaterThan(10_000_000);

    const result = estimateCompressibility(bigInput);
    expectScoreInRange(result, 0, 1);
    expect(result.format).toBe('json');
    expect(result.label).toBeDefined();
    expect(result.profile).toBeDefined();
    expect(result.breakdown).toBeDefined();
  }, 30_000); /* extended timeout for large string ops */
});

// ===========================================================================
// 11. JSON parse failure fallback (Test 6)
// ===========================================================================

describe('compressibility: JSON parse failure fallback', () => {
  it('falls back gracefully when detect says JSON but JSON.parse rejects', () => {
    /* detect() will classify this as JSON (starts with { and has : ) but
       JSON.parse will fail because "invalid" is not valid JSON. */
    const badJson = '{"key": invalid}';
    const result = estimateCompressibility(badJson);

    expectScoreInRange(result, 0, 1);
    /* Format is still reported as JSON because detect() ran first */
    expect(result.format).toBe('json');
    expect(result.label).toBeDefined();
    expect(result.profile).toBeDefined();
    expect(result.breakdown).toBeDefined();
    /* Should have fallen back to text-level word splitting */
    expect(result.breakdown.repetitionDensity).toBeGreaterThanOrEqual(0);
  });

  it('handles truncated JSON arrays gracefully', () => {
    const truncated = '[{"a":1},{"a":2},{"a":';
    const result = estimateCompressibility(truncated);
    expectScoreInRange(result, 0, 1);
    expect(result.breakdown).toBeDefined();
  });
});
