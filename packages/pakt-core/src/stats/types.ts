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
  /** Project identifier (working directory basename). */
  project?: string;
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
  /** Only include records from sessions in this project. */
  project?: string;
}

/** Metadata for session initialization. */
export interface SessionMeta {
  agent: string;
  pid: number;
  startedAt: number;
  /** Project identifier (working directory basename). */
  project?: string;
}

/** Aggregated stats for a single project across all sessions. */
export interface ProjectStats {
  /** Project identifier. */
  project: string;
  /** Total compression calls. */
  totalCalls: number;
  /** Total input tokens processed. */
  totalInputTokens: number;
  /** Total output tokens produced. */
  totalOutputTokens: number;
  /** Total tokens saved. */
  totalSavedTokens: number;
  /** Weighted average savings percentage. */
  overallSavingsPercent: number;
  /** Estimated cost saved at the given model's pricing. */
  costSaved: { input: number; output: number; currency: string } | null;
  /** ISO date of first recorded session. */
  firstSeen: string;
  /** ISO date of most recent recorded session. */
  lastSeen: string;
}

/** Aggregated stats across all projects. */
export interface LifetimeStats {
  /** Total tokens saved across all projects. */
  totalSavedTokens: number;
  /** Total calls across all projects. */
  totalCalls: number;
  /** Per-project breakdown. */
  projects: ProjectStats[];
}

/** Info about a currently-active session (no footer found). */
export interface ActiveSession {
  sessionId: string;
  agent: string;
  pid: number;
  startedAt: number;
  recordCount: number;
}
