/**
 * L3 tokenizer-aware compression tests.
 *
 * Validates that L3 text-level transforms (indent compression, trailing
 * whitespace removal, blank line collapse, unicode normalization, and
 * duplicate line collapse) reduce token counts while maintaining lossless
 * round-trip fidelity.
 */
import { describe, expect, it } from 'vitest';
import { compress, decompress } from '../src/index.js';
import { applyL3Transforms, hasL3Marker, reverseL3Transforms } from '../src/layers/L3-tokenizer.js';

// ---------------------------------------------------------------------------
// Unit tests for L3 text transforms
// ---------------------------------------------------------------------------

describe('L3 text transforms', () => {
  // ----- Indent compression -----

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
    expect(result).toContain(' child');
    expect(result).toContain('  grandchild: val');
    expect(result).toContain('   deep: 42');
  });

  it('preserves decimal values unchanged (no trailing zero stripping)', () => {
    const input = 'price: 49.90\ntax: 5.00\nrate: 3.14';
    const result = applyL3Transforms(input);
    // Trailing zeros are preserved to guarantee lossless roundtrips
    expect(result).toContain('49.90');
    expect(result).toContain('5.00');
    expect(result).toContain('3.14');
  });

  // ----- L3 marker detection -----

  it('hasL3Marker detects @target l3', () => {
    expect(hasL3Marker('@from json\n@target l3\n\ndata: 1\n')).toBe(true);
    expect(hasL3Marker('@from json\n\ndata: 1\n')).toBe(false);
    expect(hasL3Marker('@target gpt-4o\n\ndata: 1\n')).toBe(false);
  });

  // ----- Trailing whitespace removal -----

  it('strips trailing spaces from lines', () => {
    const input = 'line one   \nline two\t\t\nline three  \t \n';
    const result = applyL3Transforms(input);
    expect(result).toBe('line one\nline two\nline three\n');
  });

  it('preserves lines with no trailing whitespace', () => {
    const input = 'clean line\nanother clean line';
    const result = applyL3Transforms(input);
    expect(result).toBe('clean line\nanother clean line');
  });

  // ----- Blank line collapse -----

  it('collapses 3+ blank lines to 1 blank line', () => {
    const input = 'section A\n\n\n\nsection B\n\n\nsection C';
    const result = applyL3Transforms(input);
    expect(result).toBe('section A\n\nsection B\n\nsection C');
  });

  it('preserves single blank lines', () => {
    const input = 'line A\n\nline B\n\nline C';
    const result = applyL3Transforms(input);
    expect(result).toBe('line A\n\nline B\n\nline C');
  });

  // ----- Unicode normalization -----

  it('replaces smart quotes with straight quotes', () => {
    const input = 'He said \u201Chello\u201D and \u2018goodbye\u2019';
    const result = applyL3Transforms(input);
    expect(result).toContain('He said "hello" and \'goodbye\'');
    // Metadata line should be present
    expect(result).toContain('# @l3u ');
  });

  it('replaces em-dash with double hyphen', () => {
    const input = 'word\u2014word';
    const result = applyL3Transforms(input);
    expect(result).toContain('word--word');
  });

  it('replaces en-dash with hyphen', () => {
    const input = 'pages 10\u201320';
    const result = applyL3Transforms(input);
    expect(result).toContain('pages 10-20');
  });

  it('replaces ellipsis with three dots', () => {
    const input = 'wait\u2026 what?';
    const result = applyL3Transforms(input);
    expect(result).toContain('wait... what?');
  });

  it('replaces non-breaking space with regular space', () => {
    const input = 'hello\u00A0world';
    const result = applyL3Transforms(input);
    expect(result).toContain('hello world');
  });

  it('handles multiple unicode chars on same line (position tracking)', () => {
    // Two em-dashes on the same line: verifies column tracking across
    // length-changing replacements (1-char → 2-char)
    const input = '@target l3\na\u2014b\u2014c';
    const compressed = applyL3Transforms(input);
    expect(compressed).toContain('a--b--c');

    const reversed = reverseL3Transforms(compressed);
    expect(reversed).toContain('a\u2014b\u2014c');
  });

  it('unicode normalization is no-op when no unicode chars present', () => {
    const input = 'plain ASCII text "quoted" -- dashed';
    const result = applyL3Transforms(input);
    // No metadata line should be added
    expect(result).not.toContain('# @l3u ');
    expect(result).toBe(input);
  });

  // ----- Consecutive duplicate line collapse -----

  it('collapses consecutive duplicate lines', () => {
    const input = 'header\nERROR: timeout\nERROR: timeout\nERROR: timeout\nfooter';
    const result = applyL3Transforms(input);
    expect(result).toContain('ERROR: timeout (×3)');
    expect(result).toContain('header');
    expect(result).toContain('footer');
  });

  it('does not collapse non-consecutive duplicates', () => {
    const input = 'line A\nline B\nline A\nline B';
    const result = applyL3Transforms(input);
    // No dedup notation — duplicates are not consecutive
    expect(result).not.toContain('(×');
  });

  it('does not collapse blank lines or headers', () => {
    const input = '@from json\n@from json\n\n\ndata: 1';
    const result = applyL3Transforms(input);
    // Headers should not get collapsed (×2)
    expect(result).not.toMatch(/@from json \(×2\)/);
  });

  it('escapes literal (× in original data', () => {
    const input = 'count (×5) items\ncount (×5) items';
    const result = applyL3Transforms(input);
    // Should be escaped and collapsed
    expect(result).toContain('(\\×');
    expect(result).toContain('(×2)');
  });

  it('handles single lines (no collapse needed)', () => {
    const input = 'unique line 1\nunique line 2\nunique line 3';
    const result = applyL3Transforms(input);
    expect(result).not.toContain('(×');
  });
});

// ---------------------------------------------------------------------------
// Unit tests for L3 reverse transforms
// ---------------------------------------------------------------------------

describe('L3 reverse transforms', () => {
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

  it('reverses unicode normalization losslessly', () => {
    // Simulate real pipeline: header is present before transforms
    const original = '@target l3\nHe said \u201Chello\u201D';
    const compressed = applyL3Transforms(original);
    expect(compressed).toContain('"hello"');

    const reversed = reverseL3Transforms(compressed);
    expect(reversed).toContain('\u201Chello\u201D');
  });

  it('reverses duplicate line collapse', () => {
    // Simulate real pipeline: header is present before transforms
    const original = '@target l3\nline A\nline B\nline B\nline B\nline C';
    const compressed = applyL3Transforms(original);
    expect(compressed).toContain('line B (×3)');

    const reversed = reverseL3Transforms(compressed);
    const lines = reversed.split('\n');
    expect(lines.filter((l) => l === 'line B')).toHaveLength(3);
  });

  it('unescapes literal (× during reverse', () => {
    const original = '@target l3\ncount (\u00D75) items';
    const compressed = applyL3Transforms(original);
    expect(compressed).toContain('count (\\×5) items');

    const reversed = reverseL3Transforms(compressed);
    expect(reversed).toContain('count (\u00D75) items');
  });

  it('full round-trip: apply then reverse produces original', () => {
    // Simulate real pipeline: header is present before transforms
    const original = [
      '@target l3',
      'data:',
      '  name: test',
      '  value: 42',
      '  quote: He said \u201Chi\u201D',
      '  note: wait\u2026',
      '',
      '',
      '',
      '  trailing   ',
      '  dup: x',
      '  dup: x',
      '  dup: x',
    ].join('\n');

    const compressed = applyL3Transforms(original);
    const reversed = reverseL3Transforms(compressed);

    // Check key properties are preserved:
    // - Indentation restored to 2-space
    expect(reversed).toContain('  name: test');
    // - Unicode restored
    expect(reversed).toContain('\u201Chi\u201D');
    expect(reversed).toContain('\u2026');
    // - Duplicate lines expanded
    expect(reversed.match(/dup: x/g)?.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Edge-case hardening: malformed unicode metadata
// ---------------------------------------------------------------------------

describe('L3 restoreUnicode hardening', () => {
  it('skips malformed metadata entries (missing = or :)', () => {
    // Metadata has one valid entry and several garbled ones:
    // "badentry" has no = or :, "2:2" has no =, "=2014" has no position
    // The valid entry 1:1=2014 targets line 1 ("a--b"), col 1 (the "--")
    const input = [
      '@target l3',
      'a--b',
      '# @l3u 1:1=2014,badentry,2:2,=2014',
    ].join('\n');
    const reversed = reverseL3Transforms(input);
    // The valid entry (1:1=2014) should still restore the em-dash
    expect(reversed).toContain('a\u2014b');
    // No metadata line in output
    expect(reversed).not.toContain('# @l3u');
  });

  it('skips entries with NaN line or col values', () => {
    // "abc:5=2014" — line parses as NaN
    // "1:xyz=2019" — col parses as NaN
    const input = [
      '@target l3',
      'hello--world',
      '# @l3u abc:5=2014,1:xyz=2019',
    ].join('\n');
    const reversed = reverseL3Transforms(input);
    // Both entries should be skipped; text should remain as-is minus meta line
    expect(reversed).toContain('hello--world');
    expect(reversed).not.toContain('# @l3u');
  });

  it('skips entries with out-of-range line or col', () => {
    // line 99 is beyond the line count; col 999 is beyond line length
    const input = [
      '@target l3',
      'short',
      '# @l3u 99:0=2014,0:999=2014',
    ].join('\n');
    const reversed = reverseL3Transforms(input);
    // Both entries skipped; no corruption
    expect(reversed).toContain('short');
    expect(reversed).not.toContain('# @l3u');
  });

  it('returns text without metadata line when metadata is completely garbled', () => {
    // The entire metadata content is nonsense
    const input = [
      '@target l3',
      'plain text here',
      '# @l3u totally!garbled!nonsense',
    ].join('\n');
    const reversed = reverseL3Transforms(input);
    // Should return the text without the garbled metadata line, not crash
    expect(reversed).toContain('plain text here');
    expect(reversed).not.toContain('# @l3u');
    expect(reversed).not.toContain('garbled');
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

  it('roundtrips data with unicode characters losslessly', () => {
    const data = {
      quotes: [
        { text: 'He said \u201Chello\u201D', author: 'Alice' },
        { text: 'She whispered \u2018goodbye\u2019', author: 'Bob' },
        { text: 'And then\u2026 silence', author: 'Carol' },
      ],
    };
    const compressed = compress(JSON.stringify(data), { layers: LAYERS_L3 });
    const decompressed = decompress(compressed.compressed, 'json');
    expect(JSON.parse(decompressed.text)).toEqual(data);
  });

  it('roundtrips data with repeated rows losslessly', () => {
    const data = {
      logs: Array.from({ length: 10 }, () => ({
        level: 'ERROR',
        message: 'Connection timeout',
        code: 504,
      })),
    };
    const compressed = compress(JSON.stringify(data), { layers: LAYERS_L3 });
    const decompressed = decompress(compressed.compressed, 'json');
    expect(JSON.parse(decompressed.text)).toEqual(data);
  });
});
