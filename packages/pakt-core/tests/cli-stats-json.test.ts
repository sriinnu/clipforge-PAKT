/**
 * @module tests/cli-stats-json
 * Tests for the `pakt stats --json` feature.
 *
 * Strategy: call {@link cmdStats} directly (no subprocess) with a
 * temp `PAKT_STATS_DIR` populated via the persister API, capturing
 * stdout via a `process.stdout.write` spy.
 *
 * Covers:
 * - Valid JSON emitted (parseable, no non-JSON bytes)
 * - `schemaVersion: 1` always present
 * - Expected top-level fields present in both zero-state and populated state
 * - Zero-state emits zeroed aggregates (not an error / empty output)
 * - Text path is unchanged when `--json` is absent
 * - Single-shot mode with `--json` emits JSON
 * - `scope` reflects the active time-range flag
 * - `--agent` filter plumbed through to JSON output
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdStats } from '../src/cli-commands-stats.js';
import type { StatsJsonOutput } from '../src/cli-commands-stats.js';
import type { ParsedArgs } from '../src/cli-commands-shared.js';
import { resetStatsDir, setDisabled } from '../src/stats/persister.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ParsedArgs value for testing. */
function makeArgs(overrides?: Partial<ParsedArgs>): ParsedArgs {
  return {
    command: 'stats',
    file: undefined,
    options: new Map(),
    flags: new Set(),
    ...overrides,
  };
}

/** Fake readInput that throws — should never be called in persistent mode. */
function neverRead(_file: string | undefined): string {
  throw new Error('readInput should not be called in persistent stats mode');
}

/**
 * Capture everything written to process.stdout.write during `fn()`.
 * Returns the concatenated output string.
 */
async function captureStdout(fn: () => void | Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    if (typeof chunk === 'string') chunks.push(chunk);
    return true;
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join('');
}

/**
 * Write a JSONL session file to `dir` with the given records.
 * Omits a footer so the session shows as active (no footer = active).
 */
function writeSessionFile(
  dir: string,
  sessionId: string,
  records: Array<{
    format: string;
    inputTokens: number;
    outputTokens: number;
    savedTokens: number;
    savingsPercent: number;
    timestamp: number;
    reversible?: boolean;
    agent?: string;
  }>,
  opts?: { agentName?: string; withFooter?: boolean },
): void {
  const lines: string[] = [];
  lines.push(
    JSON.stringify({
      t: 'h',
      agent: opts?.agentName ?? 'test-agent',
      pid: 12345,
      startedAt: records[0]?.timestamp ?? Date.now(),
    }),
  );
  for (const r of records) {
    lines.push(
      JSON.stringify({
        t: 'r',
        action: 'compress',
        format: r.format,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        savedTokens: r.savedTokens,
        savingsPercent: r.savingsPercent,
        reversible: r.reversible ?? true,
        timestamp: r.timestamp,
      }),
    );
  }
  if (opts?.withFooter) {
    lines.push(
      JSON.stringify({ t: 'f', endedAt: Date.now(), totalCalls: records.length }),
    );
  }
  writeFileSync(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tempDir: string;

/** Redirect stdin.isTTY so persistent mode is triggered. */
const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pakt-stats-json-test-'));
  process.env.PAKT_STATS_DIR = tempDir;
  resetStatsDir();
  setDisabled(false);

  // Make persistent mode activate (no file + TTY stdin)
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
});

afterEach(() => {
  // Restore isTTY
  if (originalIsTTY) {
    Object.defineProperty(process.stdin, 'isTTY', originalIsTTY);
  } else {
    // biome-ignore lint/performance/noDelete: restoring dynamic property to its original absent state
    delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
  }

  delete process.env.PAKT_STATS_DIR;
  resetStatsDir();
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Zero-state tests
// ---------------------------------------------------------------------------

describe('pakt stats --json — zero state (empty stats dir)', () => {
  it('emits valid JSON when no records exist', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('output contains no non-JSON bytes (no ANSI, no decorative text)', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    const trimmed = raw.trim();
    // Must start with { and end with }
    expect(trimmed).toMatch(/^\{/);
    expect(trimmed).toMatch(/\}$/);
    // No ANSI escape codes
    // eslint-disable-next-line no-control-regex
    expect(trimmed).not.toMatch(/\[/);
  });

  it('includes schemaVersion: 1', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;
    expect(parsed.schemaVersion).toBe(1);
  });

  it('zeroed aggregates when no records', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;

    expect(parsed.totalCalls).toBe(0);
    expect(parsed.totalInputTokens).toBe(0);
    expect(parsed.totalOutputTokens).toBe(0);
    expect(parsed.totalSavedTokens).toBe(0);
    expect(parsed.overallSavingsPercent).toBe(0);
    expect(parsed.byFormat).toEqual({});
    expect(parsed.topFormat).toBeNull();
    expect(parsed.lastCallAt).toBeNull();
    expect(parsed.estimatedCostSaved).toBeNull();
  });

  it('scope is "all time" by default', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;
    expect(parsed.scope).toBe('all time');
  });

  it('activeSessions is an empty array', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;
    expect(Array.isArray(parsed.activeSessions)).toBe(true);
    expect(parsed.activeSessions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Populated state tests
// ---------------------------------------------------------------------------

describe('pakt stats --json — populated stats', () => {
  beforeEach(() => {
    const now = Date.now();
    writeSessionFile(tempDir, 'sess-test-00000001', [
      { format: 'json', inputTokens: 1000, outputTokens: 400, savedTokens: 600, savingsPercent: 60, timestamp: now - 5000 },
      { format: 'json', inputTokens: 500, outputTokens: 200, savedTokens: 300, savingsPercent: 60, timestamp: now - 4000 },
      { format: 'yaml', inputTokens: 800, outputTokens: 600, savedTokens: 200, savingsPercent: 25, timestamp: now - 3000 },
    ]);
  });

  it('emits valid JSON with populated data', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('schemaVersion is 1', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;
    expect(parsed.schemaVersion).toBe(1);
  });

  it('aggregates token counts correctly', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;

    expect(parsed.totalCalls).toBe(3);
    expect(parsed.totalInputTokens).toBe(2300);   // 1000+500+800
    expect(parsed.totalOutputTokens).toBe(1200);  // 400+200+600
    expect(parsed.totalSavedTokens).toBe(1100);   // 600+300+200
  });

  it('includes byFormat breakdown', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;

    expect(parsed.byFormat).toHaveProperty('json');
    expect(parsed.byFormat).toHaveProperty('yaml');
    expect(parsed.byFormat['json']?.calls).toBe(2);
    expect(parsed.byFormat['yaml']?.calls).toBe(1);
  });

  it('topFormat is the format with the most calls', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;

    expect(parsed.topFormat).not.toBeNull();
    expect(parsed.topFormat?.format).toBe('json');
    expect(parsed.topFormat?.calls).toBe(2);
  });

  it('lastCallAt is an ISO string', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;

    expect(parsed.lastCallAt).toBeTruthy();
    expect(() => new Date(parsed.lastCallAt!)).not.toThrow();
    expect(new Date(parsed.lastCallAt!).toISOString()).toBe(parsed.lastCallAt);
  });

  it('all required top-level fields present', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const required = [
      'schemaVersion', 'scope', 'model', 'sessionDuration',
      'totalCalls', 'callsByAction', 'totalInputTokens', 'totalOutputTokens',
      'totalSavedTokens', 'overallSavingsPercent', 'byFormat', 'topFormat',
      'estimatedCostSaved', 'lastCallAt', 'activeSessions', 'latencyMs', 'lossy',
    ] as const;

    for (const field of required) {
      expect(parsed, `missing field: ${field}`).toHaveProperty(field);
    }
  });

  it('model defaults to gpt-4o', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;
    expect(parsed.model).toBe('gpt-4o');
  });

  it('respects --model option', async () => {
    const args = makeArgs({
      flags: new Set(['json']),
      options: new Map([['model', 'claude-sonnet']]),
    });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;
    expect(parsed.model).toBe('claude-sonnet');
  });
});

// ---------------------------------------------------------------------------
// Scope / time-range tests
// ---------------------------------------------------------------------------

describe('pakt stats --json — scope labels', () => {
  it('scope is "today" when --today flag set', async () => {
    const args = makeArgs({ flags: new Set(['json', 'today']) });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;
    expect(parsed.scope).toBe('today');
  });

  it('scope is "last 7 days" when --week flag set', async () => {
    const args = makeArgs({ flags: new Set(['json', 'week']) });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;
    expect(parsed.scope).toBe('last 7 days');
  });
});

// ---------------------------------------------------------------------------
// --agent filter test
// ---------------------------------------------------------------------------

describe('pakt stats --json --agent', () => {
  it('filters records to the named agent', async () => {
    const now = Date.now();

    writeSessionFile(tempDir, 'sess-alice-00000001', [
      { format: 'json', inputTokens: 1000, outputTokens: 400, savedTokens: 600, savingsPercent: 60, timestamp: now },
    ], { agentName: 'alice' });

    writeSessionFile(tempDir, 'sess-bob-00000002', [
      { format: 'json', inputTokens: 2000, outputTokens: 800, savedTokens: 1200, savingsPercent: 60, timestamp: now },
    ], { agentName: 'bob' });

    const args = makeArgs({
      flags: new Set(['json']),
      options: new Map([['agent', 'alice']]),
    });
    const raw = await captureStdout(() => cmdStats(args, neverRead));
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;

    // Only alice's single call should be included
    expect(parsed.totalCalls).toBe(1);
    expect(parsed.totalInputTokens).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Text path unchanged (no --json)
// ---------------------------------------------------------------------------

describe('pakt stats text path (no --json)', () => {
  it('emits human-readable text when --json not set', async () => {
    const now = Date.now();
    writeSessionFile(tempDir, 'sess-text-00000001', [
      { format: 'json', inputTokens: 500, outputTokens: 200, savedTokens: 300, savingsPercent: 60, timestamp: now },
    ]);

    const args = makeArgs(); // no json flag
    const raw = await captureStdout(() => cmdStats(args, neverRead));

    // Should contain the label-style lines, not JSON
    expect(raw).toContain('Total calls:');
    expect(raw).toContain('Saved tokens:');
    // Should NOT be parseable as standalone JSON
    expect(() => JSON.parse(raw)).toThrow();
  });

  it('text output is byte-identical to previous format', async () => {
    const now = Date.now();
    writeSessionFile(tempDir, 'sess-text-00000002', [
      { format: 'yaml', inputTokens: 800, outputTokens: 640, savedTokens: 160, savingsPercent: 20, timestamp: now },
    ]);

    const args = makeArgs();
    const raw = await captureStdout(() => cmdStats(args, neverRead));

    expect(raw).toContain('Scope:');
    expect(raw).toContain('Model:');
    expect(raw).toContain('Total calls:       1');
    expect(raw).toContain('Input tokens:      800');
    expect(raw).toContain('Saved tokens:      160');
    expect(raw).toContain('Savings:           20%');
  });
});

// ---------------------------------------------------------------------------
// Single-shot --json (piped stdin / file input)
// ---------------------------------------------------------------------------

describe('pakt stats --json — single-shot mode (stdin pipe)', () => {
  beforeEach(() => {
    // Simulate non-TTY stdin so single-shot mode activates
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  });

  it('emits valid JSON for a piped JSON input', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() =>
      cmdStats(args, () => '{"users":[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]}'),
    );
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;
    expect(parsed.schemaVersion).toBe(1);
  });

  it('scope is "single-shot" in single-shot mode', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() =>
      cmdStats(args, () => '{"key":"value"}'),
    );
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;
    expect(parsed.scope).toBe('single-shot');
  });

  it('totalCalls is 1 after compressing one input', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() =>
      cmdStats(args, () => '{"a":1,"b":2,"c":3}'),
    );
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;
    expect(parsed.totalCalls).toBe(1);
  });

  it('activeSessions is empty in single-shot mode', async () => {
    const args = makeArgs({ flags: new Set(['json']) });
    const raw = await captureStdout(() =>
      cmdStats(args, () => '{"x":1}'),
    );
    const parsed: StatsJsonOutput = JSON.parse(raw) as StatsJsonOutput;
    expect(parsed.activeSessions).toEqual([]);
  });
});
