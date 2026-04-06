/**
 * @module stats/persister
 * File-based persistence for PAKT session stats.
 *
 * Each MCP server instance writes to its own JSONL file in `~/.pakt/stats/`.
 * This eliminates write contention across 10+ concurrent agents.
 * Reads aggregate across all session files for cross-agent reporting.
 */

import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CallRecord } from '../mcp/session-stats.js';
import type {
  ActiveSession,
  DailySummary,
  ReadOptions,
  SessionFooter,
  SessionHeader,
  SessionMeta,
  StatsLine,
} from './types.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let disabled = false;
let cachedStatsDir: string | undefined;

// ---------------------------------------------------------------------------
// Directory management
// ---------------------------------------------------------------------------

/**
 * Returns the stats directory path, creating it if needed.
 * Uses `PAKT_STATS_DIR` env var for testing, falls back to `~/.pakt/stats/`.
 * Sets `disabled` flag on failure so writes become no-ops.
 */
export function getStatsDir(): string {
  if (cachedStatsDir) return cachedStatsDir;

  const dir = process.env.PAKT_STATS_DIR ?? join(homedir(), '.pakt', 'stats');
  try {
    mkdirSync(dir, { recursive: true });
    cachedStatsDir = dir;
    return dir;
  } catch {
    disabled = true;
    return dir;
  }
}

/** Testing hook: disable/enable all file I/O. */
export function setDisabled(value: boolean): void {
  disabled = value;
}

/** Reset memoized directory (for tests). */
export function resetStatsDir(): void {
  cachedStatsDir = undefined;
}

// ---------------------------------------------------------------------------
// Session ID
// ---------------------------------------------------------------------------

function sanitizeAgentNameForSessionId(agentName?: string): string {
  const normalized = (agentName ?? 'agent')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 32);

  return normalized || 'agent';
}

/** Generate a unique session ID: `sess-{agentName}-{8 hex chars}`. */
export function generateSessionId(agentName?: string): string {
  const name = sanitizeAgentNameForSessionId(agentName);
  const suffix = randomBytes(4).toString('hex');
  return `sess-${name}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Session file path
// ---------------------------------------------------------------------------

function sessionFilePath(sessionId: string): string {
  return join(getStatsDir(), `${sessionId}.jsonl`);
}

// ---------------------------------------------------------------------------
// Write operations (append-only, synchronous)
// ---------------------------------------------------------------------------

function appendLine(filePath: string, obj: object): void {
  if (disabled) return;
  try {
    appendFileSync(filePath, `${JSON.stringify(obj)}\n`);
  } catch {
    // Graceful degradation — don't crash the MCP server over stats
  }
}

/** Write the session header line (first line of the file). */
export function initSession(sessionId: string, meta: SessionMeta): void {
  const header: SessionHeader = {
    t: 'h',
    agent: meta.agent,
    pid: meta.pid,
    startedAt: meta.startedAt,
  };
  appendLine(sessionFilePath(sessionId), header);
}

/** Append a single call record as JSONL. */
export function appendRecord(sessionId: string, record: CallRecord): void {
  appendLine(sessionFilePath(sessionId), { t: 'r', ...record });
}

/** Write the session footer line on graceful shutdown. */
export function finalizeSession(
  sessionId: string,
  footer: { endedAt: number; totalCalls: number },
): void {
  const footerLine: SessionFooter = { t: 'f', ...footer };
  appendLine(sessionFilePath(sessionId), footerLine);
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/** Parse a single JSONL line, returning null for malformed lines. */
function parseLine(line: string): StatsLine | null {
  try {
    const obj = JSON.parse(line) as StatsLine;
    if (obj && typeof obj === 'object' && 't' in obj) return obj;
    return null;
  } catch {
    return null;
  }
}

/** Read and parse all lines from a JSONL file. */
function readLines(filePath: string): StatsLine[] {
  try {
    const content = readFileSync(filePath, 'utf8');
    const results: StatsLine[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      const parsed = parseLine(line);
      if (parsed) results.push(parsed);
    }
    return results;
  } catch {
    return [];
  }
}

/** Extract metadata from a session file's lines. */
function parseSessionFile(filePath: string): {
  header: SessionHeader | null;
  records: CallRecord[];
  footer: SessionFooter | null;
} {
  const lines = readLines(filePath);
  let header: SessionHeader | null = null;
  const records: CallRecord[] = [];
  let footer: SessionFooter | null = null;

  for (const line of lines) {
    switch (line.t) {
      case 'h':
        header = line;
        break;
      case 'r': {
        const { t: _, ...record } = line;
        records.push(record as CallRecord);
        break;
      }
      case 'f':
        footer = line;
        break;
      case 'd':
        // Daily summaries in archive get converted to synthetic CallRecords
        records.push({
          action: 'compress',
          format: line.format as CallRecord['format'],
          inputTokens: line.inputTokens,
          outputTokens: line.outputTokens,
          savedTokens: line.savedTokens,
          savingsPercent:
            line.inputTokens > 0 ? Math.round((line.savedTokens / line.inputTokens) * 100) : 0,
          reversible: true,
          timestamp: new Date(line.date).getTime(),
        });
        break;
    }
  }

  return { header, records, footer };
}

/** List all .jsonl files in the stats directory. */
function listSessionFiles(): string[] {
  try {
    const dir = getStatsDir();
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Read all CallRecords from all session files + archive.
 * Supports filtering by time, agent name, and active-only sessions.
 */
export function readAllRecords(options?: ReadOptions): CallRecord[] {
  const files = listSessionFiles();
  const allRecords: CallRecord[] = [];

  for (const filePath of files) {
    const { header, records, footer } = parseSessionFile(filePath);

    // Filter by agent name
    if (options?.agent && header && header.agent !== options.agent) continue;

    // Filter active-only (sessions without a footer)
    if (options?.activeOnly && footer) continue;

    for (const record of records) {
      // Filter by timestamp
      if (options?.since && record.timestamp < options.since) continue;
      allRecords.push(record);
    }
  }

  return allRecords;
}

/**
 * Return metadata about currently-active sessions (those without a footer).
 */
export function getActiveSessions(): ActiveSession[] {
  const files = listSessionFiles();
  const active: ActiveSession[] = [];

  for (const filePath of files) {
    const { header, records, footer } = parseSessionFile(filePath);
    if (footer) continue; // Session is closed
    if (!header) continue; // No header — malformed

    const fileName = filePath.split('/').pop() ?? '';
    const sessionId = fileName.replace('.jsonl', '');

    active.push({
      sessionId,
      agent: header.agent,
      pid: header.pid,
      startedAt: header.startedAt,
      recordCount: records.length,
    });
  }

  return active;
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

/**
 * Compact old session files into daily summaries in archive.jsonl.
 * Sessions older than `maxAgeDays` (default 7) with a footer are compacted.
 * Returns the number of sessions compacted and archive entries created.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: compaction reads files, parses records, aggregates daily summaries, and does atomic write
export function compactSessions(maxAgeDays = 7): { compacted: number; archived: number } {
  const dir = getStatsDir();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const files = listSessionFiles();
  const archivePath = join(dir, 'archive.jsonl');

  // Read existing archive summaries
  const existingArchive = existsSync(archivePath) ? readFileSync(archivePath, 'utf8') : '';

  const dailyAccum: Record<
    string,
    { calls: number; inputTokens: number; outputTokens: number; savedTokens: number }
  > = {};

  let compacted = 0;
  const filesToDelete: string[] = [];

  for (const filePath of files) {
    if (filePath.endsWith('archive.jsonl')) continue;

    const { header, records, footer } = parseSessionFile(filePath);

    // Only compact sessions that are closed and old enough
    if (!footer) continue;
    if (!header || header.startedAt > cutoff) continue;

    for (const record of records) {
      const date = new Date(record.timestamp).toISOString().slice(0, 10);
      const key = `${date}:${record.format}`;
      const acc = dailyAccum[key];
      if (acc) {
        acc.calls++;
        acc.inputTokens += record.inputTokens;
        acc.outputTokens += record.outputTokens;
        acc.savedTokens += record.savedTokens;
      } else {
        dailyAccum[key] = {
          calls: 1,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          savedTokens: record.savedTokens,
        };
      }
    }

    filesToDelete.push(filePath);
    compacted++;
  }

  if (compacted === 0) return { compacted: 0, archived: 0 };

  // Build new archive lines
  const newLines: string[] = [];
  for (const [key, acc] of Object.entries(dailyAccum)) {
    const [date, format] = key.split(':');
    const summary: DailySummary = {
      t: 'd',
      // biome-ignore lint/style/noNonNullAssertion: split always produces both parts from 'date:format' key
      date: date!,
      // biome-ignore lint/style/noNonNullAssertion: split always produces both parts from 'date:format' key
      format: format!,
      ...acc,
    };
    newLines.push(JSON.stringify(summary));
  }

  // Write to temp then atomic rename
  const tmpPath = `${archivePath}.tmp`;
  try {
    const newContent = existingArchive + newLines.join('\n') + (newLines.length > 0 ? '\n' : '');
    writeFileSync(tmpPath, newContent);
    renameSync(tmpPath, archivePath);

    // Delete compacted session files
    for (const f of filesToDelete) {
      try {
        unlinkSync(f);
      } catch {
        // Best effort
      }
    }
  } catch {
    // If compaction fails, leave everything as-is
    try {
      unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup failure
    }
  }

  return { compacted, archived: newLines.length };
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/** Remove all files in the stats directory. */
export function resetAll(): void {
  try {
    const dir = getStatsDir();
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  } catch {
    // Graceful degradation
  }
}
