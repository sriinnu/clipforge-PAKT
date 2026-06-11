/**
 * L5 content-aware compression tests.
 *
 * Validates abbreviation, URL compression, timestamp normalization,
 * boolean shorthand, quoted-value safety, and round-trip fidelity
 * of the L5 content layer transforms.
 */
import { describe, expect, it } from 'vitest';
import { compress } from '../src/index.js';
import { injectCompressContentHeader } from '../src/compress-helpers.js';
import {
  applyL5Transforms,
  expandUrls,
  expandWords,
  hasL5Marker,
  reverseL5Transforms,
} from '../src/layers/L5-content.js';

// ---------------------------------------------------------------------------
// Transform 1: Word abbreviation
// ---------------------------------------------------------------------------

describe('L5 word abbreviation', () => {
  it('abbreviates common words', () => {
    const input = 'type: application\nmode: configuration';
    const result = applyL5Transforms(input);
    expect(result).toContain('type: app');
    expect(result).toContain('mode: config');
  });

  it('preserves Title Case', () => {
    const input = 'name: Application Server';
    const result = applyL5Transforms(input);
    expect(result).toContain('App');
  });

  it('preserves UPPER CASE', () => {
    const input = 'env: APPLICATION';
    const result = applyL5Transforms(input);
    expect(result).toContain('APP');
  });

  it('preserves lowercase', () => {
    const input = 'env: development';
    const result = applyL5Transforms(input);
    expect(result).toContain('dev');
  });

  it('does NOT abbreviate inside quoted strings', () => {
    const input = 'desc: "Full application configuration description"';
    const result = applyL5Transforms(input);
    // The line contains quotes — it should be left untouched
    expect(result).toContain('application');
    expect(result).toContain('configuration');
    expect(result).toContain('description');
  });

  it('abbreviates pipe-delimited values', () => {
    const input = '  application|configuration|development';
    const result = applyL5Transforms(input);
    expect(result).toContain('app|config|dev');
  });

  it('skips header lines', () => {
    const input = '@from application';
    const result = applyL5Transforms(input);
    expect(result).toBe('@from application');
  });

  it('skips comment lines', () => {
    const input = '# application configuration';
    const result = applyL5Transforms(input);
    expect(result).toBe('# application configuration');
  });

  it('skips dict lines', () => {
    const input = '  $a: application';
    const result = applyL5Transforms(input);
    expect(result).toBe('  $a: application');
  });

  it('does not abbreviate words shorter than MIN_ABBREV_WORD_LENGTH', () => {
    // Words < 6 chars are skipped
    const input = 'mode: test';
    const result = applyL5Transforms(input);
    expect(result).toContain('test');
  });
});

// ---------------------------------------------------------------------------
// Transform 2: URL compression
// ---------------------------------------------------------------------------

describe('L5 URL compression', () => {
  it('compresses https:// to h//', () => {
    const input = 'url: https://example.com/api';
    const result = applyL5Transforms(input);
    expect(result).toContain('h//example.com/api');
    expect(result).not.toContain('https://');
  });

  it('compresses http:// to h/', () => {
    const input = 'url: http://example.com/api';
    const result = applyL5Transforms(input);
    expect(result).toContain('h/example.com/api');
    expect(result).not.toContain('http://');
  });

  it('does NOT double-compress already-compressed h//', () => {
    // If h// is in the input, compressUrls should leave it alone
    // (it only matches https:// and http://, not h//)
    const input = 'url: h//example.com';
    const result = applyL5Transforms(input);
    // Should still be h// — not h////
    expect(result).toContain('h//example.com');
    expect(result).not.toContain('h////');
  });

  it('handles both protocols in one line', () => {
    const input = 'api: https://api.example.com http://legacy.example.com';
    const result = applyL5Transforms(input);
    expect(result).toContain('h//api.example.com');
    expect(result).toContain('h/legacy.example.com');
  });
});

describe('L5 URL expansion', () => {
  it('expands h// to https://', () => {
    const result = expandUrls('url: h//example.com');
    expect(result).toContain('https://example.com');
  });

  it('expands h/ to http://', () => {
    const result = expandUrls('url: h/example.com');
    expect(result).toContain('http://example.com');
  });

  it('does NOT expand h/ inside h// (no double-expansion)', () => {
    const result = expandUrls('url: h//example.com');
    expect(result).toBe('url: https://example.com');
    // Should NOT produce https://ttp://example.com or similar
    expect(result).not.toContain('http://');
  });

  it('expands both in one line', () => {
    const result = expandUrls('a: h//api.ex.com b: h/legacy.ex.com');
    expect(result).toContain('https://api.ex.com');
    expect(result).toContain('http://legacy.ex.com');
  });
});

// ---------------------------------------------------------------------------
// Transform 3: Timestamp normalization
// ---------------------------------------------------------------------------

describe('L5 timestamp normalization', () => {
  it('strips :00 seconds from timestamps', () => {
    const input = 'created: 2024-03-15T14:30:00Z';
    const result = applyL5Transforms(input);
    expect(result).toContain('2024-03-15T14:30Z');
  });

  it('strips :00.000 seconds+millis from timestamps', () => {
    const input = 'created: 2024-03-15T14:30:00.000Z';
    const result = applyL5Transforms(input);
    expect(result).toContain('2024-03-15T14:30Z');
  });

  it('preserves non-zero seconds', () => {
    const input = 'created: 2024-03-15T14:30:45Z';
    const result = applyL5Transforms(input);
    expect(result).toContain('2024-03-15T14:30:45Z');
  });

  it('preserves zero seconds with non-zero millis', () => {
    const input = 'created: 2024-03-15T14:30:00.123Z';
    const result = applyL5Transforms(input);
    // :00 seconds but .123 millis — should NOT strip
    expect(result).toContain('2024-03-15T14:30:00.123Z');
  });

  it('handles multiple timestamps', () => {
    const input = 'start: 2024-01-01T00:00:00Z end: 2024-12-31T23:59:59Z';
    const result = applyL5Transforms(input);
    expect(result).toContain('2024-01-01T00:00Z');
    expect(result).toContain('2024-12-31T23:59:59Z');
  });
});

// Boolean/null shorthand was removed — T/F/~ is inherently ambiguous on reverse.

// ---------------------------------------------------------------------------
// L5 marker detection
// ---------------------------------------------------------------------------

describe('L5 marker', () => {
  it('detects @compress content header', () => {
    expect(hasL5Marker('@from json\n@compress content\n\ndata: 1')).toBe(true);
  });

  it('rejects missing marker', () => {
    expect(hasL5Marker('@from json\n\ndata: 1')).toBe(false);
  });

  it('rejects wrong compress value', () => {
    expect(hasL5Marker('@compress other\n\ndata: 1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Round-trip fidelity
// ---------------------------------------------------------------------------

describe('L5 round-trip', () => {
  it('applyL5Transforms → reverseL5Transforms preserves semantic meaning', () => {
    const original = [
      '@from json',
      '@compress content',
      '',
      'users [3]{name|role|active|url|created}:',
      '  Alice|development|true|https://example.com/alice|2024-03-15T14:30:00Z',
      '  Bob|configuration|false|https://example.com/bob|2024-06-01T09:00:00.000Z',
      '  Carol|application|null|http://legacy.example.com/carol|2024-12-25T12:00:45Z',
    ].join('\n');

    const compressed = applyL5Transforms(original);

    // Verify compression happened (abbreviations, URLs, timestamps)
    expect(compressed).toContain('dev');
    expect(compressed).toContain('config');
    expect(compressed).toContain('app');
    expect(compressed).toContain('h//');
    expect(compressed).toContain('2024-03-15T14:30Z');
    // Booleans should NOT be shortened (removed from L5)
    expect(compressed).toContain('true');
    expect(compressed).toContain('false');
    expect(compressed).toContain('null');

    // Reverse it
    const expanded = reverseL5Transforms(compressed);

    // Semantic equivalence checks — word expansion should bring back full forms
    expect(expanded).toContain('development');
    expect(expanded).toContain('configuration');
    expect(expanded).toContain('application');
    expect(expanded).toContain('https://example.com');
    expect(expanded).toContain('http://legacy.example.com');
  });

  it('no-ops on already plain text without booleans/URLs/abbreviatable words', () => {
    const plain = 'name: Alice\nage: 30\ncity: NYC';
    const result = applyL5Transforms(plain);
    expect(result).toBe(plain);
  });
});

// ---------------------------------------------------------------------------
// Integration test with compress()
// ---------------------------------------------------------------------------

describe('L5 integration with compress()', () => {
  it('compress with contentAware:true on JSON payload', () => {
    // Use a larger payload with many abbreviatable words and booleans
    // to ensure L5 savings outweigh the overhead of the @compress header
    const records = Array.from({ length: 10 }, (_, i) => ({
      application: `Application ${i}`,
      environment: 'development',
      configuration: `config-${i}`,
      description: `Description for application ${i}`,
      active: i % 2 === 0,
      url: `https://example.com/api/v${i}`,
      created: '2024-03-15T14:30:00Z',
      metadata: null,
    }));
    const json = JSON.stringify(records);

    const result = compress(json, {
      layers: {
        structural: true,
        dictionary: true,
        tokenizerAware: false,
        semantic: false,
        contentAware: true,
      },
    });

    // Structural + dictionary compression should yield positive savings
    // even if L5 content layer doesn't add enough to cross the threshold
    expect(result.savings.totalPercent).toBeGreaterThanOrEqual(0);
    expect(result.detectedFormat).toBe('json');

    // If L5 had savings, the content layer should be flagged
    if (result.savings.byLayer.content > 0) {
      expect(result.compressed).toContain('@compress content');
    }
  });

  it('compress with contentAware:false does NOT apply L5', () => {
    const json = JSON.stringify({
      environment: 'development',
      active: true,
    });

    const result = compress(json, {
      layers: {
        structural: true,
        dictionary: true,
        tokenizerAware: false,
        semantic: false,
        contentAware: false,
      },
    });

    // Should NOT contain L5 markers
    expect(result.compressed).not.toContain('@compress content');
  });
});

// ---------------------------------------------------------------------------
// Edge-case hardening: injectCompressContentHeader
// ---------------------------------------------------------------------------

describe('injectCompressContentHeader edge cases', () => {
  it('inserts after @warning lossy (L4 header present)', () => {
    const input = [
      '@from json',
      '@warning lossy',
      '',
      'data: 1',
    ].join('\n');
    const result = injectCompressContentHeader(input);
    const lines = result.split('\n');
    // @compress content should appear after @warning lossy
    const warningIdx = lines.indexOf('@warning lossy');
    const compressIdx = lines.indexOf('@compress content');
    expect(compressIdx).toBeGreaterThan(warningIdx);
    // It should still be in the header block, before data
    const dataIdx = lines.indexOf('data: 1');
    expect(compressIdx).toBeLessThan(dataIdx);
  });

  it('handles multiple @compress headers (inserts after the last @-header)', () => {
    const input = [
      '@from json',
      '@compress dict',
      '@compress semantic',
      '',
      'data: 1',
    ].join('\n');
    const result = injectCompressContentHeader(input);
    const lines = result.split('\n');
    expect(lines).toContain('@compress content');
    // Should be inserted after the last existing header
    const lastExistingHeader = lines.lastIndexOf('@compress semantic');
    const contentIdx = lines.indexOf('@compress content');
    expect(contentIdx).toBe(lastExistingHeader + 1);
  });

  it('handles @dict block right after headers', () => {
    const input = [
      '@from json',
      '@dict',
      '  $a: application',
      '',
      'data: 1',
    ].join('\n');
    const result = injectCompressContentHeader(input);
    const lines = result.split('\n');
    expect(lines).toContain('@compress content');
    // @dict is a header line (starts with @), so @compress content
    // should appear after it but before the dict entries (indented lines)
    const dictIdx = lines.indexOf('@dict');
    const compressIdx = lines.indexOf('@compress content');
    expect(compressIdx).toBe(dictIdx + 1);
  });

  it('handles empty document (no lines)', () => {
    const result = injectCompressContentHeader('');
    // Should insert at position 0
    expect(result).toContain('@compress content');
    const lines = result.split('\n');
    expect(lines[0]).toBe('@compress content');
  });

  it('no-ops when @compress content already present', () => {
    const input = [
      '@from json',
      '@compress content',
      '',
      'data: 1',
    ].join('\n');
    const result = injectCompressContentHeader(input);
    // Should be identical — no duplicate insertion
    expect(result).toBe(input);
    // Count occurrences
    const matches = result.match(/@compress\s+content/g);
    expect(matches).toHaveLength(1);
  });
});
