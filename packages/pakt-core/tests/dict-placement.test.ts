/**
 * Dictionary-as-system-prompt tests (roadmap Tier 1 item 2).
 *
 * Covers:
 * - compress with `dictPlacement: 'system'` → `dictBlock` returned, body
 *   dict-free, `decompress(body, { dict })` restores the original
 * - interaction with the @cache directive and the PII layer
 * - external/inline dictionary merge precedence (inline wins)
 * - CLI surface (`--dict-placement system --dict-out` / `--dict`)
 * - MCP surface (`pakt_compress` dictPlacement param + dictBlock result)
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdCompress, cmdDecompress } from '../src/cli-commands.js';
import { compress } from '../src/compress.js';
import { decompress } from '../src/decompress.js';
import { CACHE_DIRECTIVE } from '../src/dict-external.js';
import { handlePaktTool } from '../src/mcp/index.js';
import { resetRollingDict } from '../src/mcp/rolling-dict.js';
import type { PaktCompressResult } from '../src/mcp/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Heterogeneous keyed records so L2 (not delta encoding) does the work. */
const RECORDS = JSON.stringify(
  Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [
      `row_${String(i)}`,
      {
        a: i % 2 === 0 ? 'platform_engineering_team' : 'security_engineering_team',
        b: i % 3 === 0 ? 'security_engineering_team' : 'platform_engineering_team',
        c: i % 2 === 1 ? 'platform_engineering_team' : 'security_engineering_team',
      },
    ]),
  ),
);

/** Plain text with a heavily repeated phrase for the text-dictionary path. */
const REPETITIVE_TEXT = Array.from(
  { length: 8 },
  (_, i) => `entry ${String(i)}: the quarterly platform reliability review meeting notes`,
).join('\n');

beforeEach(() => {
  resetRollingDict();
});

// ---------------------------------------------------------------------------
// Library surface
// ---------------------------------------------------------------------------

describe('compress dictPlacement', () => {
  it("defaults to 'inline' (no dictBlock, @dict stays in the body)", () => {
    const result = compress(RECORDS);
    expect(result.dictBlock).toBeUndefined();
    expect(result.compressed).toContain('@dict');
  });

  it("'system' returns dictBlock and a dict-free body that round-trips", () => {
    const result = compress(RECORDS, { dictPlacement: 'system' });
    expect(result.dictBlock).toBeDefined();
    expect(result.dictBlock).toContain('@dict');
    expect(result.dictBlock).toContain('@end');
    expect(result.compressed).not.toContain('@dict');
    // Body still references aliases.
    expect(result.compressed).toMatch(/\$[a-z]/);

    const restored = decompress(result.compressed, { dict: result.dictBlock });
    expect(restored.wasLossy).toBe(false);
    expect(JSON.parse(restored.text)).toEqual(JSON.parse(RECORDS));
  });

  it('moves the @cache directive into dictBlock when a cacheTarget is set', () => {
    const result = compress(RECORDS, { dictPlacement: 'system', target: 'anthropic' });
    expect(result.dictBlock).toContain(CACHE_DIRECTIVE);
    expect(result.compressed).not.toContain(CACHE_DIRECTIVE);
    // The whole dictBlock is the cacheable unit — no offset hint on the body.
    expect(result.cacheBreakpoint).toBeUndefined();

    const restored = decompress(result.compressed, { dict: result.dictBlock });
    expect(JSON.parse(restored.text)).toEqual(JSON.parse(RECORDS));
  });

  it('works on the plain-text dictionary path', () => {
    const inline = compress(REPETITIVE_TEXT);
    expect(inline.compressed).toContain('@dict'); // sanity: text path aliased

    const result = compress(REPETITIVE_TEXT, { dictPlacement: 'system' });
    expect(result.dictBlock).toBeDefined();
    expect(result.compressed).not.toContain('@dict');

    const restored = decompress(result.compressed, { dict: result.dictBlock });
    expect(restored.text).toBe(REPETITIVE_TEXT);
  });

  it('round-trips with the PII layer (flag mode) active', () => {
    /* The shared on-call address repeats, so it lands in the dictionary
       itself — the PII scan must still flag it (the post-pass scans dict
       expansions too) and the system-placement round-trip must hold. */
    const withPII = JSON.stringify(
      Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [
          `row_${String(i)}`,
          {
            a: i % 2 === 0 ? 'platform_engineering_team' : 'security_engineering_team',
            b: i % 3 === 0 ? 'security_engineering_team' : 'platform_engineering_team',
            contact: 'oncall-rotation@example.com',
          },
        ]),
      ),
    );
    const result = compress(withPII, { dictPlacement: 'system', piiMode: 'flag' });
    expect(result.piiCounts?.email).toBeGreaterThan(0);
    expect(result.dictBlock).toBeDefined();
    expect(result.reversible).toBe(true);

    const restored = decompress(result.compressed, { dict: result.dictBlock });
    expect(JSON.parse(restored.text)).toEqual(JSON.parse(withPII));
  });

  it('omits dictBlock when nothing was worth aliasing', () => {
    const result = compress('{"a":1,"b":2}', { dictPlacement: 'system', dictMinSavings: 999 });
    expect(result.dictBlock).toBeUndefined();
    const restored = decompress(result.compressed);
    expect(JSON.parse(restored.text)).toEqual({ a: 1, b: 2 });
  });
});

describe('decompress external dict merge', () => {
  it('inline entries win on alias conflicts; external fills the gaps', () => {
    const body = '@from json\n@dict\n  $a: alpha\n@end\n\nk1: $a\nk2: $b\n';
    const externalDict = '@dict\n  $a: beta\n  $b: gamma\n@end';

    const restored = decompress(body, { dict: externalDict });
    expect(JSON.parse(restored.text)).toEqual({ k1: 'alpha', k2: 'gamma' });
  });

  it('tolerates a trailing @cache directive inside the dict block', () => {
    const result = compress(RECORDS, { dictPlacement: 'system', target: 'bedrock' });
    // dictBlock carries "@dict ... @end\n@cache prefix-end" — must merge fine.
    const restored = decompress(result.compressed, { dict: result.dictBlock });
    expect(JSON.parse(restored.text)).toEqual(JSON.parse(RECORDS));
  });

  it('keeps the legacy positional outputFormat argument working', () => {
    const result = compress(RECORDS);
    const restored = decompress(result.compressed, 'json');
    expect(JSON.parse(restored.text)).toEqual(JSON.parse(RECORDS));
  });
});

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

describe('CLI --dict-placement / --dict', () => {
  let dir: string;
  let stdoutChunks: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pakt-dict-'));
    stdoutChunks = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as ReturnType<typeof vi.spyOn>;
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true) as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  const readInput = (file: string | undefined): string => readFileSync(file ?? '', 'utf8');
  const parseLayers = (): undefined => undefined;

  it('compress writes the dict block to --dict-out and decompress merges it back', () => {
    const inputPath = join(dir, 'input.json');
    const dictPath = join(dir, 'dict.pakt');
    const bodyPath = join(dir, 'body.pakt');
    writeFileSync(inputPath, RECORDS, 'utf8');

    cmdCompress(
      {
        command: 'compress',
        file: inputPath,
        options: new Map([
          ['dict-placement', 'system'],
          ['dict-out', dictPath],
        ]),
        flags: new Set(),
      },
      readInput,
      parseLayers,
    );

    const body = stdoutChunks.join('');
    const dict = readFileSync(dictPath, 'utf8');
    expect(dict).toContain('@dict');
    expect(body).not.toContain('@dict');
    writeFileSync(bodyPath, body, 'utf8');

    stdoutChunks.length = 0;
    cmdDecompress(
      {
        command: 'decompress',
        file: bodyPath,
        options: new Map([
          ['dict', dictPath],
          ['to', 'json'],
        ]),
        flags: new Set(),
      },
      readInput,
    );

    expect(JSON.parse(stdoutChunks.join(''))).toEqual(JSON.parse(RECORDS));
  });

  it('rejects --dict-placement system without --dict-out', () => {
    const inputPath = join(dir, 'input.json');
    writeFileSync(inputPath, RECORDS, 'utf8');
    expect(() =>
      cmdCompress(
        {
          command: 'compress',
          file: inputPath,
          options: new Map([['dict-placement', 'system']]),
          flags: new Set(),
        },
        readInput,
        parseLayers,
      ),
    ).toThrow('--dict-out');
  });
});

// ---------------------------------------------------------------------------
// MCP surface
// ---------------------------------------------------------------------------

describe('MCP pakt_compress dictPlacement', () => {
  it("returns dictBlock with dictPlacement: 'system' and round-trips", () => {
    const result = handlePaktTool('pakt_compress', {
      text: RECORDS,
      dictPlacement: 'system',
    }) as PaktCompressResult;

    expect(result.dictBlock).toBeDefined();
    expect(result.compressed).not.toContain('@dict');

    const restored = decompress(result.compressed, { dict: result.dictBlock });
    expect(JSON.parse(restored.text)).toEqual(JSON.parse(RECORDS));
  });

  it('rejects invalid dictPlacement values', () => {
    expect(() =>
      handlePaktTool('pakt_compress', { text: RECORDS, dictPlacement: 'sideways' }),
    ).toThrow('dictPlacement must be one of');
  });

  it('rejects invalid cacheTarget values', () => {
    expect(() =>
      handlePaktTool('pakt_compress', { text: RECORDS, cacheTarget: 'minitel' }),
    ).toThrow('cacheTarget must be one of');
  });

  it('combines dictPlacement system with cacheTarget (directive in dictBlock)', () => {
    const result = handlePaktTool('pakt_compress', {
      text: RECORDS,
      dictPlacement: 'system',
      cacheTarget: 'anthropic',
    }) as PaktCompressResult;

    expect(result.dictBlock).toContain(CACHE_DIRECTIVE);
    expect(result.cacheByteOffset).toBeUndefined();
    const restored = decompress(result.compressed, { dict: result.dictBlock });
    expect(JSON.parse(restored.text)).toEqual(JSON.parse(RECORDS));
  });
});
