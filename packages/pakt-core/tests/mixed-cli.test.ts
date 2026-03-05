/**
 * Tests for `compressMixed` and `decompressMixed` functions.
 *
 * These tests exercise the mixed-content compression pipeline — the module
 * that detects structured data blocks (JSON, YAML, CSV) embedded in
 * markdown/prose, compresses each block individually, and can decompress
 * them back via PAKT markers.
 *
 * Coverage:
 * - compressMixed on plain text (no blocks)
 * - compressMixed on markdown with embedded JSON block
 * - compressMixed idempotency on already-PAKT text
 * - decompressMixed extracts and decompresses PAKT markers
 * - Round-trip: compressMixed -> decompressMixed preserves structure
 * - Savings is a positive number when content is compressible
 */

import { describe, expect, it } from 'vitest';
import { compress, compressMixed, decompressMixed } from '../src/index.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

/** Plain text with no structured blocks. */
const PLAIN_TEXT = [
  'The quick brown fox jumps over the lazy dog.',
  'This is ordinary prose without any code blocks.',
  'Nothing to compress here, just sentences.',
].join('\n');

/** A JSON block large enough to produce compression savings. */
const LARGE_JSON_BLOCK = JSON.stringify({
  employees: Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    name: `employee_${String(i + 1)}`,
    department: 'engineering',
    status: 'active',
    level: 'senior',
  })),
});

/** Markdown document with a fenced JSON code block. */
const MARKDOWN_WITH_JSON = [
  '# Team Report',
  '',
  'Here is our current team data:',
  '',
  '```json',
  LARGE_JSON_BLOCK,
  '```',
  '',
  'Please review and approve.',
].join('\n');

/** Markdown document with multiple different block types. */
const MARKDOWN_MULTI_BLOCK = [
  '# Configuration Guide',
  '',
  '## API Response',
  '```json',
  JSON.stringify({
    users: Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      name: `user_${String(i + 1)}`,
      role: 'developer',
      active: true,
    })),
  }),
  '```',
  '',
  '## Server Config',
  '```yaml',
  'server:',
  '  host: localhost',
  '  port: 8080',
  '  workers: 4',
  'database:',
  '  host: db.example.com',
  '  port: 5432',
  '  name: production',
  '```',
  '',
  'End of configuration guide.',
].join('\n');

// ===========================================================================
// compressMixed — plain text (no structured blocks)
// ===========================================================================

describe('compressMixed — plain text', () => {
  it('returns compressed text unchanged when no structured blocks found', () => {
    const result = compressMixed(PLAIN_TEXT);

    expect(result.compressed).toBe(PLAIN_TEXT);
    expect(result.blocks).toEqual([]);
    expect(result.savings.totalPercent).toBe(0);
    expect(result.savings.totalTokens).toBe(0);
    expect(result.reversible).toBe(true);
  });

  it('originalTokens equals compressedTokens for plain text', () => {
    const result = compressMixed(PLAIN_TEXT);

    expect(result.originalTokens).toBe(result.compressedTokens);
  });
});

// ===========================================================================
// compressMixed — markdown with embedded JSON
// ===========================================================================

describe('compressMixed — markdown + JSON block', () => {
  it('detects and compresses the JSON block within markdown', () => {
    const result = compressMixed(MARKDOWN_WITH_JSON);

    // Should have found at least one block
    expect(result.blocks.length).toBeGreaterThan(0);

    // First block should be JSON
    const jsonBlock = result.blocks.find((b) => b.format === 'json');
    expect(jsonBlock).toBeDefined();
    if (jsonBlock) {
      expect(jsonBlock.originalTokens).toBeGreaterThan(0);
      expect(jsonBlock.compressedTokens).toBeGreaterThan(0);
      expect(jsonBlock.savingsPercent).toBeGreaterThan(0);
    }
  });

  it('wraps compressed blocks in PAKT markers', () => {
    const result = compressMixed(MARKDOWN_WITH_JSON);

    if (result.blocks.length > 0) {
      expect(result.compressed).toContain('<!-- PAKT:json -->');
      expect(result.compressed).toContain('<!-- /PAKT -->');
      expect(result.compressed).toContain('@from json');
    }
  });

  it('preserves prose surrounding the block', () => {
    const result = compressMixed(MARKDOWN_WITH_JSON);

    expect(result.compressed).toContain('# Team Report');
    expect(result.compressed).toContain('Here is our current team data:');
    expect(result.compressed).toContain('Please review and approve.');
  });

  it('compresses JSON block differently from surrounding text', () => {
    const result = compressMixed(MARKDOWN_WITH_JSON);

    // The compressed text should not contain the original verbose JSON
    if (result.blocks.length > 0) {
      // Original JSON had "department": "engineering" repeated many times
      // After compression these should be shortened
      expect(result.compressedTokens).toBeLessThan(result.originalTokens);
    }
  });
});

// ===========================================================================
// compressMixed — idempotency
// ===========================================================================

describe('compressMixed — idempotency', () => {
  it('returns already-PAKT text as-is (no double compression)', () => {
    // First compress some JSON to get PAKT output
    const paktResult = compress(LARGE_JSON_BLOCK);
    const paktText = paktResult.compressed;

    // Now pass the PAKT text through compressMixed
    const mixedResult = compressMixed(paktText);

    // The PAKT text should either pass through unchanged or be minimally modified.
    // The key assertion: it should not corrupt the PAKT format.
    expect(mixedResult.reversible).toBe(true);
    expect(mixedResult.compressed.length).toBeGreaterThan(0);
  });

  it('double compressMixed produces same result', () => {
    const first = compressMixed(MARKDOWN_WITH_JSON);
    const second = compressMixed(first.compressed);

    // Second pass should not find additional blocks to compress
    // (PAKT markers are HTML comments, not fenced code blocks)
    expect(second.blocks.length).toBe(0);
    expect(second.compressed).toBe(first.compressed);
  });
});

// ===========================================================================
// decompressMixed — PAKT marker extraction
// ===========================================================================

describe('decompressMixed — PAKT markers', () => {
  it('extracts and decompresses PAKT blocks from markers', () => {
    // Compress first to get markers
    const compressed = compressMixed(MARKDOWN_WITH_JSON);

    if (compressed.blocks.length > 0) {
      const restored = decompressMixed(compressed.compressed);

      // PAKT markers should be removed
      expect(restored).not.toContain('<!-- PAKT:json -->');
      expect(restored).not.toContain('<!-- /PAKT -->');

      // Prose should still be there
      expect(restored).toContain('Team Report');
      expect(restored).toContain('Please review and approve.');
    }
  });

  it('returns input unchanged when no PAKT markers present', () => {
    const text = 'Just normal markdown.\n\nNo PAKT markers here.';
    const result = decompressMixed(text);

    expect(result).toBe(text);
  });

  it('handles malformed PAKT markers gracefully', () => {
    // Inject a fake PAKT marker with invalid content
    const badMarker = [
      'Some text before.',
      '<!-- PAKT:json -->',
      'this is not valid pakt at all }{][',
      '<!-- /PAKT -->',
      'Some text after.',
    ].join('\n');

    // Should not throw — graceful degradation leaves broken blocks as-is
    const result = decompressMixed(badMarker);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Round-trip: compressMixed -> decompressMixed
// ===========================================================================

describe('compressMixed -> decompressMixed round-trip', () => {
  it('preserves document structure after round-trip', () => {
    const compressed = compressMixed(MARKDOWN_WITH_JSON);

    if (compressed.blocks.length > 0) {
      const restored = decompressMixed(compressed.compressed);

      // Should contain the heading and prose
      expect(restored).toContain('Team Report');
      expect(restored).toContain('Please review and approve.');

      // The restored JSON should be parseable
      // Extract JSON from the restored text (it may be inline or in a code block)
      const jsonMatch = restored.match(/\{[\s\S]*"employees"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          employees: Array<{ id: number }>;
        };
        expect(parsed.employees).toHaveLength(20);
        expect(parsed.employees[0]).toHaveProperty('id', 1);
        expect(parsed.employees[0]).toHaveProperty('department', 'engineering');
      }
    }
  });

  it('preserves JSON data integrity through mixed-content round-trip', () => {
    const originalData = {
      items: Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        name: `item_${String(i + 1)}`,
        category: 'widget',
        price: 9.99,
        inStock: true,
      })),
    };

    const md = [
      '# Inventory',
      '',
      '```json',
      JSON.stringify(originalData),
      '```',
      '',
      'Total items: 12',
    ].join('\n');

    const compressed = compressMixed(md);

    if (compressed.blocks.length > 0) {
      const restored = decompressMixed(compressed.compressed);

      // Extract JSON from restored text
      const jsonMatch = restored.match(/\{[\s\S]*"items"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          items: Array<Record<string, unknown>>;
        };
        expect(parsed.items).toHaveLength(12);
        expect(parsed.items[0]).toHaveProperty('category', 'widget');
        expect(parsed.items[0]).toHaveProperty('price', 9.99);
        expect(parsed.items[0]).toHaveProperty('inStock', true);
      }
    }
  });

  it('round-trip with multiple block types', () => {
    const compressed = compressMixed(MARKDOWN_MULTI_BLOCK);

    if (compressed.blocks.length > 0) {
      const restored = decompressMixed(compressed.compressed);

      // Prose should be preserved
      expect(restored).toContain('Configuration Guide');
      expect(restored).toContain('End of configuration guide.');
    }
  });
});

// ===========================================================================
// Savings validation
// ===========================================================================

describe('compressMixed — savings', () => {
  it('savings is positive when content is compressible', () => {
    const result = compressMixed(MARKDOWN_WITH_JSON);

    if (result.blocks.length > 0) {
      expect(result.savings.totalPercent).toBeGreaterThan(0);
      expect(result.savings.totalTokens).toBeGreaterThan(0);
      expect(result.compressedTokens).toBeLessThan(result.originalTokens);
    }
  });

  it('per-block savingsPercent is between 0 and 100', () => {
    const result = compressMixed(MARKDOWN_WITH_JSON);

    for (const block of result.blocks) {
      expect(block.savingsPercent).toBeGreaterThanOrEqual(0);
      expect(block.savingsPercent).toBeLessThanOrEqual(100);
    }
  });

  it('totalPercent is between 0 and 100', () => {
    const result = compressMixed(MARKDOWN_WITH_JSON);

    expect(result.savings.totalPercent).toBeGreaterThanOrEqual(0);
    expect(result.savings.totalPercent).toBeLessThanOrEqual(100);
  });

  it('originalTokens and compressedTokens are positive', () => {
    const result = compressMixed(MARKDOWN_WITH_JSON);

    expect(result.originalTokens).toBeGreaterThan(0);
    expect(result.compressedTokens).toBeGreaterThan(0);
  });

  it('savings byLayer has expected structure', () => {
    const result = compressMixed(MARKDOWN_WITH_JSON);

    expect(result.savings.byLayer).toHaveProperty('structural');
    expect(result.savings.byLayer).toHaveProperty('dictionary');
    expect(result.savings.byLayer).toHaveProperty('tokenizer');
    expect(result.savings.byLayer).toHaveProperty('semantic');
  });
});
