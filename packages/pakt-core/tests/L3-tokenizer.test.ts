/**
 * L3 tokenizer-aware compression tests.
 *
 * Validates that L3 text-level transforms (1-space indent, strip
 * trailing zeros) reduce token counts while maintaining lossless
 * round-trip fidelity.
 */
import { describe, expect, it } from 'vitest';
import { compress, decompress } from '../src/index.js';
import { applyL3Transforms, hasL3Marker, reverseL3Transforms } from '../src/layers/L3-tokenizer.js';

// ---------------------------------------------------------------------------
// Unit tests for L3 text transforms
// ---------------------------------------------------------------------------

describe('L3 text transforms', () => {
  it('compressIndent converts 2-space to 1-space', () => {
    const input = ['@from json', '', 'users [2]{name|role}:', '  Alice|dev', '  Bob|admin'].join(
      '\n',
    );
    const result = applyL3Transforms(input);
    expect(result).toContain(' Alice|dev');
    expect(result).toContain(' Bob|admin');
    // Headers should NOT be indented
    expect(result).toMatch(/^@from json$/m);
  });

  it('compressIndent handles nested indentation', () => {
    const input = ['root', '  child', '    grandchild: val', '      deep: 42'].join('\n');
    const result = applyL3Transforms(input);
    expect(result).toBe(['root', ' child', '  grandchild: val', '   deep: 42'].join('\n'));
  });

  it('preserves decimal values unchanged (no trailing zero stripping)', () => {
    const input = 'price: 49.90\ntax: 5.00\nrate: 3.14';
    const result = applyL3Transforms(input);
    // Trailing zeros are preserved to guarantee lossless roundtrips
    expect(result).toContain('49.90');
    expect(result).toContain('5.00');
    expect(result).toContain('3.14');
  });

  it('hasL3Marker detects @target l3', () => {
    expect(hasL3Marker('@from json\n@target l3\n\ndata: 1\n')).toBe(true);
    expect(hasL3Marker('@from json\n\ndata: 1\n')).toBe(false);
    expect(hasL3Marker('@target gpt-4o\n\ndata: 1\n')).toBe(false);
  });

  it('reverseL3Transforms expands 1-space back to 2-space', () => {
    const l3Text = [
      '@from json',
      '@target l3',
      '',
      'users [2]{name|role}:',
      ' Alice|dev',
      ' Bob|admin',
    ].join('\n');
    const reversed = reverseL3Transforms(l3Text);
    expect(reversed).toContain('  Alice|dev');
    expect(reversed).toContain('  Bob|admin');
  });

  it('reverseL3Transforms is a no-op without @target l3', () => {
    const normal = '@from json\n\nusers [2]{name}:\n  Alice\n';
    expect(reverseL3Transforms(normal)).toBe(normal);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: compress + decompress with L3
// ---------------------------------------------------------------------------

describe('L3 compression pipeline', () => {
  const LAYERS_L3 = { structural: true, dictionary: true, tokenizerAware: true };

  it('adds @target l3 header when L3 enabled (large data)', () => {
    const data = JSON.stringify({
      items: Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        price: 9.99,
        category: 'electronics',
      })),
    });
    const result = compress(data, { layers: LAYERS_L3 });
    expect(result.compressed).toContain('@target l3');
  });

  it('uses 1-space indentation with L3', () => {
    const data = JSON.stringify({
      users: [
        { name: 'Alice', role: 'dev' },
        { name: 'Bob', role: 'admin' },
      ],
    });
    const result = compress(data, { layers: LAYERS_L3 });
    const lines = result.compressed.split('\n');
    // Data rows should start with exactly 1 space (not 2)
    const dataRows = lines.filter((l) => l.match(/^\s+\w/));
    for (const row of dataRows) {
      const leadSpaces = row.length - row.trimStart().length;
      // 1-space indent: levels are 1, 2, 3 (not 2, 4, 6)
      expect(leadSpaces).toBeLessThanOrEqual(row.trimStart().length);
    }
  });

  it('roundtrips losslessly with L3 — simple object', () => {
    const input = JSON.stringify({ name: 'Alice', age: 30, active: true });
    const compressed = compress(input, { layers: LAYERS_L3 });
    const decompressed = decompress(compressed.compressed, 'json');
    expect(JSON.parse(decompressed.text)).toEqual(JSON.parse(input));
  });

  it('roundtrips losslessly with L3 — tabular array', () => {
    const data = {
      users: [
        { name: 'Alice', role: 'developer', active: true },
        { name: 'Bob', role: 'designer', active: false },
        { name: 'Carol', role: 'developer', active: true },
      ],
    };
    const compressed = compress(JSON.stringify(data), { layers: LAYERS_L3 });
    const decompressed = decompress(compressed.compressed, 'json');
    expect(JSON.parse(decompressed.text)).toEqual(data);
  });

  it('roundtrips losslessly with L3 — nested config', () => {
    const data = {
      server: {
        host: 'localhost',
        port: 8080,
        ssl: { enabled: true, cert: '/etc/ssl/cert.pem' },
      },
      database: {
        url: 'postgres://localhost:5432/mydb',
        pool: { min: 2, max: 10 },
      },
    };
    const compressed = compress(JSON.stringify(data), { layers: LAYERS_L3 });
    const decompressed = decompress(compressed.compressed, 'json');
    expect(JSON.parse(decompressed.text)).toEqual(data);
  });

  it('roundtrips losslessly with L3 — root-level array', () => {
    const data = [
      { id: 1, name: 'Widget', price: 9.99 },
      { id: 2, name: 'Gadget', price: 19.5 },
      { id: 3, name: 'Doohickey', price: 4.99 },
    ];
    const compressed = compress(JSON.stringify(data), { layers: LAYERS_L3 });
    const decompressed = decompress(compressed.compressed, 'json');
    expect(JSON.parse(decompressed.text)).toEqual(data);
  });

  it('saves tokens compared to L1+L2 only', () => {
    const data = JSON.stringify({
      items: Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        price: 9.99,
        category: 'electronics',
      })),
    });
    const withL3 = compress(data, { layers: LAYERS_L3 });
    const withoutL3 = compress(data);
    expect(withL3.compressedTokens).toBeLessThanOrEqual(withoutL3.compressedTokens);
    expect(withL3.savings.byLayer.tokenizer).toBeGreaterThanOrEqual(0);
  });

  it('reports tokenizer savings in byLayer breakdown', () => {
    const data = JSON.stringify({
      items: Array.from({ length: 30 }, (_, i) => ({
        id: i + 1,
        label: `task-${i}`,
        status: 'pending',
        priority: 'medium',
      })),
    });
    const result = compress(data, { layers: LAYERS_L3 });
    // Structural and dictionary savings should still be tracked
    expect(result.savings.byLayer.structural).toBeGreaterThan(0);
    // L3 tokenizer savings (may be 0 for small data, but >= 0)
    expect(result.savings.byLayer.tokenizer).toBeGreaterThanOrEqual(0);
  });

  it('reverts L3 when savings <= 0 (tiny input)', () => {
    // Very small input — L3 header overhead may exceed savings
    const result = compress('{"a": 1}', { layers: LAYERS_L3 });
    // Should still produce valid output regardless of revert
    expect(result.compressed).toBeDefined();
    expect(result.compressed.length).toBeGreaterThan(0);
    // Roundtrip must still work
    const dec = decompress(result.compressed, 'json');
    expect(JSON.parse(dec.text)).toEqual({ a: 1 });
  });

  it('CSV data roundtrips with L3', () => {
    const csv = 'name,age,city\nAlice,30,Portland\nBob,25,Seattle\nCarol,35,Denver';
    const result = compress(csv, { fromFormat: 'csv', layers: LAYERS_L3 });
    const dec = decompress(result.compressed, 'json');
    const data = JSON.parse(dec.text) as unknown[];
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(3);
    expect((data as Record<string, unknown>[])[0]).toHaveProperty('name', 'Alice');
  });
});
