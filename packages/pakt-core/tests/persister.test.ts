import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CallRecord } from '../src/mcp/session-stats.js';
import {
  appendRecord,
  compactSessions,
  finalizeSession,
  generateSessionId,
  getActiveSessions,
  getStatsDir,
  initSession,
  readAllRecords,
  resetAll,
  resetStatsDir,
  setDisabled,
} from '../src/stats/persister.js';

let tempDir: string;

function makeRecord(overrides?: Partial<CallRecord>): CallRecord {
  return {
    action: 'compress',
    format: 'json',
    inputTokens: 100,
    outputTokens: 30,
    savedTokens: 70,
    savingsPercent: 70,
    reversible: true,
    timestamp: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pakt-stats-test-'));
  process.env.PAKT_STATS_DIR = tempDir;
  resetStatsDir();
  setDisabled(false);
});

afterEach(() => {
  process.env.PAKT_STATS_DIR = undefined;
  resetStatsDir();
});

describe('getStatsDir', () => {
  it('creates the directory if it does not exist', () => {
    const subDir = join(tempDir, 'nested', 'stats');
    process.env.PAKT_STATS_DIR = subDir;
    resetStatsDir();

    const dir = getStatsDir();
    expect(dir).toBe(subDir);
    expect(existsSync(subDir)).toBe(true);
  });
});

describe('generateSessionId', () => {
  it('produces a valid session ID with default agent name', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^sess-agent-[0-9a-f]{8}$/);
  });

  it('uses the provided agent name', () => {
    const id = generateSessionId('research');
    expect(id).toMatch(/^sess-research-[0-9a-f]{8}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateSessionId()));
    expect(ids.size).toBe(20);
  });
});

describe('session lifecycle', () => {
  it('writes header, records, and footer', () => {
    const sessionId = 'sess-test-abcd1234';
    const now = Date.now();

    initSession(sessionId, { agent: 'test', pid: 1234, startedAt: now });
    appendRecord(sessionId, makeRecord({ timestamp: now + 1000 }));
    appendRecord(sessionId, makeRecord({ format: 'csv', timestamp: now + 2000 }));
    finalizeSession(sessionId, { endedAt: now + 3000, totalCalls: 2 });

    const filePath = join(tempDir, `${sessionId}.jsonl`);
    expect(existsSync(filePath)).toBe(true);

    const lines = readFileSync(filePath, 'utf8').trim().split('\n');
    expect(lines.length).toBe(4);

    const header = JSON.parse(lines[0]!);
    expect(header.t).toBe('h');
    expect(header.agent).toBe('test');
    expect(header.pid).toBe(1234);

    const record1 = JSON.parse(lines[1]!);
    expect(record1.t).toBe('r');
    expect(record1.format).toBe('json');

    const record2 = JSON.parse(lines[2]!);
    expect(record2.t).toBe('r');
    expect(record2.format).toBe('csv');

    const footer = JSON.parse(lines[3]!);
    expect(footer.t).toBe('f');
    expect(footer.totalCalls).toBe(2);
  });
});

describe('readAllRecords', () => {
  it('reads records from all session files', () => {
    const id1 = 'sess-a-00000001';
    const id2 = 'sess-b-00000002';

    initSession(id1, { agent: 'a', pid: 1, startedAt: Date.now() });
    appendRecord(id1, makeRecord());
    appendRecord(id1, makeRecord());

    initSession(id2, { agent: 'b', pid: 2, startedAt: Date.now() });
    appendRecord(id2, makeRecord({ format: 'csv' }));

    const records = readAllRecords();
    expect(records.length).toBe(3);
  });

  it('filters by agent name', () => {
    const id1 = 'sess-research-00000001';
    const id2 = 'sess-codegen-00000002';

    initSession(id1, { agent: 'research', pid: 1, startedAt: Date.now() });
    appendRecord(id1, makeRecord());

    initSession(id2, { agent: 'codegen', pid: 2, startedAt: Date.now() });
    appendRecord(id2, makeRecord());

    const records = readAllRecords({ agent: 'research' });
    expect(records.length).toBe(1);
  });

  it('filters by timestamp', () => {
    const old = Date.now() - 100_000;
    const recent = Date.now();

    const id = 'sess-test-00000001';
    initSession(id, { agent: 'test', pid: 1, startedAt: old });
    appendRecord(id, makeRecord({ timestamp: old }));
    appendRecord(id, makeRecord({ timestamp: recent }));

    const records = readAllRecords({ since: recent - 1000 });
    expect(records.length).toBe(1);
  });

  it('filters active-only sessions', () => {
    const id1 = 'sess-active-00000001';
    const id2 = 'sess-closed-00000002';

    initSession(id1, { agent: 'active', pid: 1, startedAt: Date.now() });
    appendRecord(id1, makeRecord());

    initSession(id2, { agent: 'closed', pid: 2, startedAt: Date.now() });
    appendRecord(id2, makeRecord());
    finalizeSession(id2, { endedAt: Date.now(), totalCalls: 1 });

    const records = readAllRecords({ activeOnly: true });
    expect(records.length).toBe(1);
  });

  it('skips corrupt JSONL lines gracefully', () => {
    const id = 'sess-corrupt-00000001';
    initSession(id, { agent: 'test', pid: 1, startedAt: Date.now() });
    appendRecord(id, makeRecord());

    // Manually inject a corrupt line
    const filePath = join(tempDir, `${id}.jsonl`);
    const { appendFileSync } = require('node:fs');
    appendFileSync(filePath, 'this is not json\n');
    appendRecord(id, makeRecord());

    const records = readAllRecords();
    expect(records.length).toBe(2); // skipped the corrupt line
  });
});

describe('getActiveSessions', () => {
  it('returns sessions without a footer', () => {
    const id1 = 'sess-running-00000001';
    const id2 = 'sess-done-00000002';

    initSession(id1, { agent: 'running', pid: 100, startedAt: Date.now() });
    appendRecord(id1, makeRecord());
    appendRecord(id1, makeRecord());

    initSession(id2, { agent: 'done', pid: 200, startedAt: Date.now() });
    appendRecord(id2, makeRecord());
    finalizeSession(id2, { endedAt: Date.now(), totalCalls: 1 });

    const active = getActiveSessions();
    expect(active.length).toBe(1);
    expect(active[0]!.agent).toBe('running');
    expect(active[0]!.pid).toBe(100);
    expect(active[0]!.recordCount).toBe(2);
  });
});

describe('compactSessions', () => {
  it('compacts old closed sessions into archive.jsonl', () => {
    const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago
    const id = 'sess-old-00000001';

    initSession(id, { agent: 'old', pid: 1, startedAt: oldTime });
    appendRecord(id, makeRecord({ timestamp: oldTime, format: 'json' }));
    appendRecord(id, makeRecord({ timestamp: oldTime + 1000, format: 'json' }));
    appendRecord(id, makeRecord({ timestamp: oldTime + 2000, format: 'csv' }));
    finalizeSession(id, { endedAt: oldTime + 3000, totalCalls: 3 });

    const result = compactSessions(7);
    expect(result.compacted).toBe(1);
    expect(result.archived).toBeGreaterThan(0);

    // Original session file should be deleted
    expect(existsSync(join(tempDir, `${id}.jsonl`))).toBe(false);

    // Archive should exist and contain daily summaries
    const archivePath = join(tempDir, 'archive.jsonl');
    expect(existsSync(archivePath)).toBe(true);

    const archiveContent = readFileSync(archivePath, 'utf8');
    const lines = archiveContent.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);

    const first = JSON.parse(lines[0]!);
    expect(first.t).toBe('d');
  });

  it('does not compact active sessions', () => {
    const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const id = 'sess-still-running-00000001';

    initSession(id, { agent: 'running', pid: 1, startedAt: oldTime });
    appendRecord(id, makeRecord({ timestamp: oldTime }));
    // No footer — session is still active

    const result = compactSessions(7);
    expect(result.compacted).toBe(0);
    expect(existsSync(join(tempDir, `${id}.jsonl`))).toBe(true);
  });

  it('reads compacted archive records in readAllRecords', () => {
    const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const id = 'sess-compact-read-00000001';

    initSession(id, { agent: 'test', pid: 1, startedAt: oldTime });
    appendRecord(
      id,
      makeRecord({ timestamp: oldTime, inputTokens: 500, outputTokens: 150, savedTokens: 350 }),
    );
    finalizeSession(id, { endedAt: oldTime + 1000, totalCalls: 1 });

    compactSessions(7);

    const records = readAllRecords();
    expect(records.length).toBeGreaterThan(0);
    expect(records[0]!.inputTokens).toBe(500);
  });
});

describe('resetAll', () => {
  it('wipes all stats files', () => {
    const id = 'sess-wipe-00000001';
    initSession(id, { agent: 'test', pid: 1, startedAt: Date.now() });
    appendRecord(id, makeRecord());

    resetAll();

    const files = readdirSync(tempDir);
    expect(files.length).toBe(0);
  });
});

describe('disabled mode', () => {
  it('does not throw when disabled', () => {
    setDisabled(true);
    const id = 'sess-disabled-00000001';

    // These should all be no-ops, not throw
    expect(() => initSession(id, { agent: 'test', pid: 1, startedAt: Date.now() })).not.toThrow();
    expect(() => appendRecord(id, makeRecord())).not.toThrow();
    expect(() => finalizeSession(id, { endedAt: Date.now(), totalCalls: 0 })).not.toThrow();

    // No file should have been created
    expect(existsSync(join(tempDir, `${id}.jsonl`))).toBe(false);
  });
});
