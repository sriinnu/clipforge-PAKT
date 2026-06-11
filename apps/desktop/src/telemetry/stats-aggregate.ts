/**
 * @module telemetry/stats-aggregate
 * Pure aggregation of parsed PAKT stats files into the dashboard model.
 *
 * Day bucketing uses UTC dates (`toISOString().slice(0, 10)`) to match
 * pakt-core's own compaction bucketing in `stats/persister.ts`, so the
 * dashboard's daily numbers line up with `archive.jsonl` summaries.
 * No React / no Tauri — unit-testable in isolation.
 */

import type { ParsedStatsFile } from './stats-schema';

// ---------------------------------------------------------------------------
// Output model
// ---------------------------------------------------------------------------

/** Tokens saved on a single UTC day (sparkline datapoint). */
export interface DayBucket {
  /** ISO date (UTC), e.g. `2026-06-10`. */
  date: string;
  /** Tokens saved that day. */
  savedTokens: number;
  /** Tool calls recorded that day. */
  calls: number;
}

/** Per-source row — grouped by the session header's `agent` field. */
export interface SourceRow {
  /** Agent name from the session header (e.g. `claude-code`). */
  agent: string;
  /** Total tool calls attributed to this agent. */
  calls: number;
  /** Total input tokens processed. */
  inputTokens: number;
  /** Total tokens saved. */
  savedTokens: number;
  /** Weighted savings percentage (0-100). */
  savingsPercent: number;
  /** True if the agent has at least one open session (no footer). */
  active: boolean;
}

/** Per-format row — grouped by each call record's `format` field. */
export interface FormatRow {
  /** Input format, e.g. `json`, `yaml`, `markdown`. */
  format: string;
  /** Calls seen with this format. */
  calls: number;
  /** Tokens saved on this format. */
  savedTokens: number;
}

/** Everything the telemetry dashboard renders, in one snapshot. */
export interface TelemetrySnapshot {
  /** True when at least one call (raw or archived) exists. */
  hasData: boolean;
  /** Tokens saved today (UTC). */
  todaySavedTokens: number;
  /** Calls recorded today (UTC). */
  todayCalls: number;
  /** Tokens saved over the trailing 7 UTC days (including today). */
  weekSavedTokens: number;
  /** Trailing 7 UTC days, oldest first — sparkline input. */
  days: DayBucket[];
  /** All-time call count. */
  totalCalls: number;
  /** All-time input tokens. */
  totalInputTokens: number;
  /** All-time saved tokens. */
  totalSavedTokens: number;
  /** All-time weighted savings percentage (0-100). */
  overallSavingsPercent: number;
  /** Mean `durationMs` across records that carry timing, or null. */
  avgLatencyMs: number | null;
  /** How many records carried a `durationMs` sample. */
  latencySamples: number;
  /** Raw records with `reversible: false` (lossy compression). */
  lossyCalls: number;
  /** Lossy calls as a share of raw records (0-100). */
  lossySharePercent: number;
  /** Per-agent breakdown, sorted by saved tokens desc. */
  sources: SourceRow[];
  /** Per-format breakdown, sorted by calls desc. */
  formats: FormatRow[];
  /** Sessions currently open (header present, footer absent). */
  activeSessionCount: number;
  /** Unix ms of the most recent call, or null. */
  lastCallAt: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a Unix ms timestamp as a UTC ISO date (`YYYY-MM-DD`). */
function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Weighted savings percentage, guarded against divide-by-zero. */
function pct(saved: number, input: number): number {
  return input > 0 ? Math.round((saved / input) * 100) : 0;
}

interface SourceAccum {
  calls: number;
  inputTokens: number;
  savedTokens: number;
  active: boolean;
}

/** Label for archive-derived rows — archive.jsonl has no session header. */
const ARCHIVE_SOURCE = 'archived';

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Fold parsed stats files into a {@link TelemetrySnapshot}.
 *
 * Latency and lossy-share are computed from raw call records only —
 * compacted daily summaries in `archive.jsonl` don't carry `durationMs`
 * or `reversible`, so pretending otherwise would skew the numbers.
 *
 * @param files - Parsed stats files from {@link parseStatsSnapshot}.
 * @param now - Clock override for tests; defaults to `Date.now()`.
 */
export function aggregateTelemetry(files: ParsedStatsFile[], now = Date.now()): TelemetrySnapshot {
  // Seed the trailing 7 UTC days so the sparkline always has 7 points.
  const dayIndex = new Map<string, DayBucket>();
  const days: DayBucket[] = [];
  const DAY_MS = 24 * 60 * 60 * 1000;
  for (let i = 6; i >= 0; i--) {
    const bucket: DayBucket = { date: utcDate(now - i * DAY_MS), savedTokens: 0, calls: 0 };
    dayIndex.set(bucket.date, bucket);
    days.push(bucket);
  }
  const today = utcDate(now);

  const sources = new Map<string, SourceAccum>();
  const formats = new Map<string, FormatRow>();

  let totalCalls = 0;
  let totalInputTokens = 0;
  let totalSavedTokens = 0;
  let rawRecordCount = 0;
  let lossyCalls = 0;
  let latencySum = 0;
  let latencySamples = 0;
  let activeSessionCount = 0;
  let lastCallAt: number | null = null;

  const bumpDay = (date: string, savedTokens: number, calls: number): void => {
    const bucket = dayIndex.get(date);
    if (!bucket) return; // Older than the 7-day window — totals still count it.
    bucket.savedTokens += savedTokens;
    bucket.calls += calls;
  };

  const bumpSource = (agent: string, rec: { inputTokens: number; savedTokens: number }): void => {
    const acc = sources.get(agent) ?? { calls: 0, inputTokens: 0, savedTokens: 0, active: false };
    acc.calls += 1;
    acc.inputTokens += rec.inputTokens;
    acc.savedTokens += rec.savedTokens;
    sources.set(agent, acc);
  };

  const bumpFormat = (format: string, calls: number, savedTokens: number): void => {
    const row = formats.get(format) ?? { format, calls: 0, savedTokens: 0 };
    row.calls += calls;
    row.savedTokens += savedTokens;
    formats.set(format, row);
  };

  for (const file of files) {
    const isOpenSession = file.header !== null && file.footer === null;
    if (isOpenSession) activeSessionCount++;
    const agent = file.header?.agent ?? ARCHIVE_SOURCE;

    for (const rec of file.records) {
      totalCalls++;
      rawRecordCount++;
      totalInputTokens += rec.inputTokens;
      totalSavedTokens += rec.savedTokens;
      if (!rec.reversible) lossyCalls++;
      if (typeof rec.durationMs === 'number') {
        latencySum += rec.durationMs;
        latencySamples++;
      }
      if (lastCallAt === null || rec.timestamp > lastCallAt) lastCallAt = rec.timestamp;

      bumpDay(utcDate(rec.timestamp), rec.savedTokens, 1);
      bumpSource(agent, rec);
      bumpFormat(rec.format, 1, rec.savedTokens);
    }

    if (isOpenSession && file.records.length > 0) {
      const acc = sources.get(agent);
      if (acc) acc.active = true;
    }

    // Archive summaries: counted into totals / days / formats, attributed
    // to the synthetic "archived" source (archive.jsonl has no agent).
    for (const summary of file.dailySummaries) {
      totalCalls += summary.calls;
      totalInputTokens += summary.inputTokens;
      totalSavedTokens += summary.savedTokens;
      bumpDay(summary.date, summary.savedTokens, summary.calls);
      bumpFormat(summary.format, summary.calls, summary.savedTokens);

      const acc = sources.get(ARCHIVE_SOURCE) ?? {
        calls: 0,
        inputTokens: 0,
        savedTokens: 0,
        active: false,
      };
      acc.calls += summary.calls;
      acc.inputTokens += summary.inputTokens;
      acc.savedTokens += summary.savedTokens;
      sources.set(ARCHIVE_SOURCE, acc);
    }
  }

  const todayBucket = dayIndex.get(today);

  return {
    hasData: totalCalls > 0,
    todaySavedTokens: todayBucket?.savedTokens ?? 0,
    todayCalls: todayBucket?.calls ?? 0,
    weekSavedTokens: days.reduce((sum, d) => sum + d.savedTokens, 0),
    days,
    totalCalls,
    totalInputTokens,
    totalSavedTokens,
    overallSavingsPercent: pct(totalSavedTokens, totalInputTokens),
    avgLatencyMs: latencySamples > 0 ? Math.round(latencySum / latencySamples) : null,
    latencySamples,
    lossyCalls,
    lossySharePercent: rawRecordCount > 0 ? Math.round((lossyCalls / rawRecordCount) * 100) : 0,
    sources: Array.from(sources.entries())
      .map(([agent, acc]) => ({
        agent,
        calls: acc.calls,
        inputTokens: acc.inputTokens,
        savedTokens: acc.savedTokens,
        savingsPercent: pct(acc.savedTokens, acc.inputTokens),
        active: acc.active,
      }))
      .sort((a, b) => b.savedTokens - a.savedTokens),
    formats: Array.from(formats.values()).sort((a, b) => b.calls - a.calls),
    activeSessionCount,
    lastCallAt,
  };
}
