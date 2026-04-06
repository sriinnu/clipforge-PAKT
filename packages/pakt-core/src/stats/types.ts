/**
 * @module stats/types
 * JSONL record types for persistent stats storage.
 *
 * Each line in a session file is one of these discriminated types,
 * identified by the `t` field: header, record, footer, or daily summary.
 */

import type { CallRecord } from '../mcp/session-stats.js';

/** First line of a session file — identifies the agent and process. */
export interface SessionHeader {
  t: 'h';
  agent: string;
  pid: number;
  startedAt: number;
}

/** Body line — a single tool call record. */
export type RawRecord = { t: 'r' } & CallRecord;

/** Last line of a session file — written on graceful shutdown. */
export interface SessionFooter {
  t: 'f';
  endedAt: number;
  totalCalls: number;
}

/** Compacted daily summary — one per day per format in archive.jsonl. */
export interface DailySummary {
  t: 'd';
  date: string;
  format: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
}

/** Discriminated union of all JSONL line types. */
export type StatsLine = SessionHeader | RawRecord | SessionFooter | DailySummary;

/** Options for filtering persistent records. */
export interface ReadOptions {
  /** Only include records at or after this timestamp. */
  since?: number;
  /** Only include records from sessions with this agent name. */
  agent?: string;
  /** Only include records from sessions that are still active (no footer). */
  activeOnly?: boolean;
}

/** Metadata for session initialization. */
export interface SessionMeta {
  agent: string;
  pid: number;
  startedAt: number;
}

/** Info about a currently-active session (no footer found). */
export interface ActiveSession {
  sessionId: string;
  agent: string;
  pid: number;
  startedAt: number;
  recordCount: number;
}
