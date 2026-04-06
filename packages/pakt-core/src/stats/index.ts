/**
 * @module stats
 * Persistent file-based stats for PAKT sessions.
 *
 * Each MCP server instance writes to its own JSONL file in `~/.pakt/stats/`.
 * The {@link readAllRecords} function aggregates across all sessions for reporting.
 */

export {
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
} from './persister.js';

export type {
  ActiveSession,
  DailySummary,
  RawRecord,
  ReadOptions,
  SessionFooter,
  SessionHeader,
  SessionMeta,
  StatsLine,
} from './types.js';
