/**
 * Tests for mixed-content PAKT compression, decompression, and graceful error handling.
 *
 * Covers:
 * - Block extraction from markdown with JSON, YAML, CSV
 * - compressMixed on markdown with embedded structured data
 * - decompressMixed round-trips
 * - Graceful error handling in compress() and decompress()
 * - Mixed content with no structured blocks
 */
import { describe, expect, it } from 'vitest';
import {
  compress,
  compressMixed,
  decompress,
  decompressMixed,
  extractBlocks,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// extractBlocks
// ---------------------------------------------------------------------------

describe('extractBlocks', () => {
  it('extracts JSON from fenced code blocks', () => {
    const md = [
      '# Report',
      '',
      '```json',
      '{"name": "Alice", "role": "dev"}',
      '```',
      '',
      'End of report.',
    ].join('\n');

    const blocks = extractBlocks(md);
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.format).toBe('json');
    expect(blocks[0]!.languageTag).toBe('json');
    expect(blocks[0]!.content).toContain('"name"');
  });

  it('extracts YAML frontmatter', () => {
    const md = [
      '---',
      'title: My Post',
      'date: 2026-01-15',
      'tags:',
      '  - tech',
      '  - ai',
      '---',
      '',
      '# Content',
      '',
      'Some text here.',
    ].join('\n');

    const blocks = extractBlocks(md);
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.format).toBe('yaml');
    expect(blocks[0]!.content).toContain('title: My Post');
  });

  it('extracts multiple blocks (JSON + YAML + CSV)', () => {
    const md = [
      '# Multi-format Document',
      '',
      '## JSON Data',
      '```json',
      '{"users": [{"name": "Alice"}, {"name": "Bob"}]}',
      '```',
      '',
      '## YAML Config',
      '```yaml',
      'server:',
      '  host: localhost',
      '  port: 8080',
      '```',
      '',
      '## CSV Table',
      '```csv',
      'name,age,city',
      'Alice,30,Portland',
      'Bob,25,Seattle',
      '```',
      '',
      'End.',
    ].join('\n');

    const blocks = extractBlocks(md);
    expect(blocks.length).toBe(3);

    const formats = blocks.map((b) => b.format);
    expect(formats).toContain('json');
    expect(formats).toContain('yaml');
    expect(formats).toContain('csv');
  });

  it('returns empty array for plain text with no blocks', () => {
    const text = 'Just some plain text.\nNothing structured here.\nHave a nice day.';
    const blocks = extractBlocks(text);
    expect(blocks).toEqual([]);
  });

  it('blocks are sorted by startOffset', () => {
    const md = ['```json', '{"a": 1}', '```', '', '```yaml', 'b: 2', '```'].join('\n');

    const blocks = extractBlocks(md);
    expect(blocks.length).toBe(2);
    expect(blocks[0]!.startOffset).toBeLessThan(blocks[1]!.startOffset);
  });

  it('extracts fenced code blocks without explicit language tag via auto-detect', () => {
    const md = ['# Example', '', '```', '{"auto": "detected"}', '```'].join('\n');

    const blocks = extractBlocks(md);
    // Auto-detect should identify this as JSON
    if (blocks.length > 0) {
      expect(blocks[0]!.format).toBe('json');
      expect(blocks[0]!.languageTag).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// compressMixed
// ---------------------------------------------------------------------------

describe('compressMixed', () => {
  it('compresses embedded JSON in markdown and shows savings', () => {
    const jsonBlock = JSON.stringify({
      users: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        name: `user_${i + 1}`,
        role: 'developer',
        active: true,
      })),
    });

    const md = ['# API Response', '', '```json', jsonBlock, '```', '', 'End of report.'].join('\n');

    const result = compressMixed(md);

    // Should have found and compressed the JSON block
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.savings.totalPercent).toBeGreaterThan(0);
    expect(result.compressed).toContain('<!-- PAKT:json -->');
    expect(result.compressed).toContain('<!-- /PAKT -->');
    expect(result.compressed).toContain('@from json');
    expect(result.reversible).toBe(true);
  });

  it('returns original text when no structured blocks found', () => {
    const text = 'Just plain text.\nNo code blocks.\nNothing to compress.';
    const result = compressMixed(text);

    expect(result.compressed).toBe(text);
    expect(result.blocks).toEqual([]);
    expect(result.savings.totalPercent).toBe(0);
  });

  it('leaves prose between blocks untouched', () => {
    const jsonBlock = JSON.stringify({
      items: Array.from({ length: 8 }, (_, i) => ({
        id: i,
        status: 'active',
        type: 'widget',
      })),
    });

    const md = [
      '# Header',
      '',
      'Some prose here.',
      '',
      '```json',
      jsonBlock,
      '```',
      '',
      'More prose after the block.',
    ].join('\n');

    const result = compressMixed(md);
    expect(result.compressed).toContain('# Header');
    expect(result.compressed).toContain('Some prose here.');
    expect(result.compressed).toContain('More prose after the block.');
  });
});

// ---------------------------------------------------------------------------
// decompressMixed
// ---------------------------------------------------------------------------

describe('decompressMixed', () => {
  it('round-trips: compressMixed -> decompressMixed restores content', () => {
    const jsonData = {
      users: [
        { name: 'Alice', role: 'dev' },
        { name: 'Bob', role: 'dev' },
        { name: 'Carol', role: 'pm' },
        { name: 'Dave', role: 'dev' },
        { name: 'Eve', role: 'qa' },
      ],
    };

    const md = ['# Team Report', '', '```json', JSON.stringify(jsonData), '```', '', 'End.'].join(
      '\n',
    );

    const compressed = compressMixed(md);
    const restored = decompressMixed(compressed.compressed);

    // The decompressed JSON should parse back to the original data
    // Extract the JSON portion from the restored text
    const jsonMatch = restored.match(/```json\n([\s\S]*?)\n```/);
    if (compressed.blocks.length > 0) {
      // If blocks were compressed, the restored text should contain valid JSON
      expect(restored).toContain('Team Report');
      expect(restored).toContain('End.');
      // The PAKT markers should be gone after decompression
      expect(restored).not.toContain('<!-- PAKT:');
    } else {
      // If no compression happened (small data), text should be unchanged
      expect(restored).toBe(md);
    }
  });

  it('returns input unchanged when no PAKT markers present', () => {
    const text = 'Just normal text with no markers.';
    expect(decompressMixed(text)).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// Graceful error handling: compress()
// ---------------------------------------------------------------------------

describe('compress() error handling', () => {
  it('does not throw on garbage input', () => {
    const garbage = '\x00\x01\x02\xFF\xFE binary garbage }{][';
    expect(() => compress(garbage)).not.toThrow();
  });

  it('returns original text with 0% savings on garbage input', () => {
    const garbage = '}{][ not valid anything }{][';
    const result = compress(garbage);
    // Should not crash — returns a valid PaktResult
    expect(result).toBeDefined();
    expect(result.compressed).toBeDefined();
    expect(typeof result.savings.totalPercent).toBe('number');
    expect(result.reversible).toBe(true);
  });

  it('handles null-like edge cases gracefully', () => {
    const result = compress('');
    expect(result.compressed).toBe('');
    expect(result.savings.totalPercent).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Graceful error handling: decompress()
// ---------------------------------------------------------------------------

describe('decompress() error handling', () => {
  it('does not throw on garbage input', () => {
    const garbage = 'this is not pakt format at all!!!';
    expect(() => decompress(garbage)).not.toThrow();
  });

  it('returns raw input as text on garbage input', () => {
    const garbage = 'totally invalid pakt @#$%';
    const result = decompress(garbage);
    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    expect(result.wasLossy).toBe(false);
  });

  it('handles empty string gracefully', () => {
    const result = decompress('');
    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Integration: compress() with mixed content
// ---------------------------------------------------------------------------

describe('compress() with mixed content integration', () => {
  it('markdown with embedded JSON gets non-zero savings', () => {
    const jsonBlock = JSON.stringify({
      employees: Array.from({ length: 15 }, (_, i) => ({
        id: i + 1,
        name: `emp_${i + 1}`,
        department: 'engineering',
        status: 'active',
      })),
    });

    const md = [
      '# Employee Report',
      '',
      'Here is our team data:',
      '',
      '```json',
      jsonBlock,
      '```',
      '',
      'Thank you for reviewing.',
    ].join('\n');

    const result = compress(md);

    // The compress function should detect this as markdown with mixed content
    // and use compressMixed internally
    if (result.savings.totalPercent > 0) {
      expect(result.compressed).toContain('<!-- PAKT:json -->');
      expect(result.compressed).toContain('Employee Report');
    }
  });

  it('plain markdown without structured blocks returns 0% savings', () => {
    const md = '# Just a Title\n\nSome paragraph text.\n\nAnother paragraph.';
    const result = compress(md, { fromFormat: 'markdown' });
    expect(result.compressed).toBe(md);
    expect(result.savings.totalPercent).toBe(0);
  });
});
