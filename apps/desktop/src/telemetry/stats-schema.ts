/**
 * @module telemetry/stats-schema
 * Types + line-level parsing for PAKT's persisted stats files.
 *
 * The shapes here mirror `packages/pakt-core/src/stats/types.ts` and
 * `packages/pakt-core/src/mcp/session-stats.ts` (CallRecord) 1:1 — the
 * JSONL files in `~/.pakt/stats/` are written by pakt-core's persister
 * and read back here. Pure module (no React, no Tauri) so the parsing
 * logic stays unit-testable; raw file contents arrive via the Rust
 * `read_pakt_stats` command.
 */

// ---------------------------------------------------------------------------
// IPC payload (matches src-tauri/src/stats.rs)
// ---------------------------------------------------------------------------

/** One raw JSONL file shipped over IPC from the Rust command. */
export interface RawStatsFile {
  /** File name, e.g. `sess-claude-code-a1b2c3d4.jsonl` or `archive.jsonl`. */
  name: string;
  /** Raw JSONL content. */
  content: string;
}

/** Full payload of the `read_pakt_stats` Tauri command. */
export interface RawStatsSnapshot {
  /** Whether `~/.pakt/stats` exists — `false` drives onboarding UI. */
  dirExists: boolean;
  /** All `*.jsonl` files found in the directory. */
  files: RawStatsFile[];
}

// ---------------------------------------------------------------------------
// JSONL record types (mirror pakt-core stats/types.ts)
// ---------------------------------------------------------------------------

/** First line of a session file — identifies the agent and process. */
export interface SessionHeader {
  t: 'h';
  /** Agent name, e.g. `claude-code`, `cursor`. */
  agent: string;
  /** Process ID of the MCP server. */
  pid: number;
  /** Unix ms timestamp when the session started. */
  startedAt: number;
  /** Optional project identifier (cwd basename). */
  project?: string;
}

/** A single recorded tool call (body line, `t: 'r'` with `t` stripped). */
export interface CallRecord {
  /** What the tool did. */
  action: 'compress' | 'decompress' | 'inspect';
  /** Detected or declared format of the input. */
  format: string;
  /** Token count of the input. */
  inputTokens: number;
  /** Token count of the output. */
  outputTokens: number;
  /** Tokens saved (inputTokens - outputTokens). */
  savedTokens: number;
  /** Savings as a percentage (0-100). */
  savingsPercent: number;
  /** Whether the operation was lossless. */
  reversible: boolean;
  /** Unix ms timestamp (Date.now()). */
  timestamp: number;
  /** Wall-clock tool-call duration in ms (absent on older records). */
  durationMs?: number;
}

/** Last line of a session file — written on graceful shutdown. */
export interface SessionFooter {
  t: 'f';
  endedAt: number;
  totalCalls: number;
}

/** Compacted daily summary — one per day per format in `archive.jsonl`. */
export interface DailySummary {
  t: 'd';
  /** ISO date (UTC), e.g. `2026-06-10`. */
  date: string;
  format: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
}

/** A fully parsed stats file (session or archive). */
export interface ParsedStatsFile {
  /** Source file name (used to derive the session id). */
  name: string;
  /** Session header, or null for archive / malformed files. */
  header: SessionHeader | null;
  /** All raw call records in the file. */
  records: CallRecord[];
  /** Footer if the session shut down gracefully, else null. */
  footer: SessionFooter | null;
  /** Compacted daily summaries (archive.jsonl only in practice). */
  dailySummaries: DailySummary[];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Narrow an unknown to a finite number, with a fallback of 0. */
function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Narrow an unknown to a non-empty string, with a fallback. */
function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** Valid `action` values for a call record; anything else is dropped. */
const ACTIONS = new Set(['compress', 'decompress', 'inspect']);

/**
 * Parse a single JSONL line into a typed record. Returns null for
 * malformed lines (matching the persister's lenient read path).
 */
export function parseStatsLine(
  line: string,
): SessionHeader | CallRecord | SessionFooter | DailySummary | null {
  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null) return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  switch (obj['t']) {
    case 'h':
      return {
        t: 'h',
        agent: str(obj['agent'], 'agent'),
        pid: num(obj['pid']),
        startedAt: num(obj['startedAt']),
        ...(typeof obj['project'] === 'string' ? { project: obj['project'] } : {}),
      };
    case 'r': {
      if (!ACTIONS.has(obj['action'] as string)) return null;
      const durationMs = obj['durationMs'];
      return {
        action: obj['action'] as CallRecord['action'],
        format: str(obj['format'], 'unknown'),
        inputTokens: num(obj['inputTokens']),
        outputTokens: num(obj['outputTokens']),
        savedTokens: num(obj['savedTokens']),
        savingsPercent: num(obj['savingsPercent']),
        reversible: obj['reversible'] !== false,
        timestamp: num(obj['timestamp']),
        ...(typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0
          ? { durationMs }
          : {}),
      };
    }
    case 'f':
      return { t: 'f', endedAt: num(obj['endedAt']), totalCalls: num(obj['totalCalls']) };
    case 'd':
      return {
        t: 'd',
        date: str(obj['date'], ''),
        format: str(obj['format'], 'unknown'),
        calls: num(obj['calls']),
        inputTokens: num(obj['inputTokens']),
        outputTokens: num(obj['outputTokens']),
        savedTokens: num(obj['savedTokens']),
      };
    default:
      return null;
  }
}

/**
 * Parse one raw JSONL stats file into header / records / footer /
 * daily-summary buckets, skipping malformed lines.
 */
export function parseStatsFile(file: RawStatsFile): ParsedStatsFile {
  const result: ParsedStatsFile = {
    name: file.name,
    header: null,
    records: [],
    footer: null,
    dailySummaries: [],
  };

  for (const rawLine of file.content.split('\n')) {
    if (!rawLine.trim()) continue;
    const parsed = parseStatsLine(rawLine);
    if (!parsed) continue;

    // Call records have no `t` after parsing; discriminate on its absence.
    if (!('t' in parsed)) {
      result.records.push(parsed);
      continue;
    }
    if (parsed.t === 'h') result.header = parsed;
    else if (parsed.t === 'f') result.footer = parsed;
    else if (parsed.t === 'd' && parsed.date) result.dailySummaries.push(parsed);
  }

  return result;
}

/** Parse every file in an IPC snapshot. */
export function parseStatsSnapshot(snapshot: RawStatsSnapshot): ParsedStatsFile[] {
  return snapshot.files.map(parseStatsFile);
}
