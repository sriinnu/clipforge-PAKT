/**
 * @module hooks/state
 * Working-state snapshot of a Claude Code session, taken from its transcript
 * just before compaction so the agent can pick up after it without
 * re-reading everything.
 *
 * @internal Node.js only. Reads the transcript JSONL Claude Code passes as
 * `transcript_path`; writes `~/.pakt/state/<session_id>.json` (dir 0700,
 * file 0600, since it holds prompts and paths).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** What survives a compaction. Every field is bounded. */
export interface SessionState {
  sessionId: string;
  takenAt: string;
  cwd?: string;
  gitBranch?: string;
  /** Files written or edited since the last compaction, most recent last. */
  filesEdited: string[];
  /** Files read since the last compaction, most recent last. */
  filesRead: string[];
  /** The user's most recent requests (typed prompts only), truncated. */
  recentRequests: string[];
  /** The last assistant text, truncated: "where we were". */
  lastAssistant?: string;
  /** Spill ids referenced since the last compaction. */
  spillIds: string[];
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const MAX_FILES = 25;
const MAX_REQUESTS = 5;
const REQUEST_CHARS = 400;
const ASSISTANT_CHARS = 600;

/** `PAKT_STATE_DIR`, falling back to `~/.pakt/state`. */
export function stateDir(): string {
  return process.env.PAKT_STATE_DIR ?? join(homedir(), '.pakt', 'state');
}

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

function statePath(sessionId: string): string | undefined {
  return SESSION_ID.test(sessionId) ? join(stateDir(), `${sessionId}.json`) : undefined;
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Append `v` keeping uniqueness and recency (re-touching moves it to the end). */
function touch(list: string[], v: string, max: number): void {
  const i = list.indexOf(v);
  if (i >= 0) list.splice(i, 1);
  list.push(v);
  if (list.length > max) list.shift();
}

/** A typed user prompt, not a tool result, command echo or system reminder. */
function typedPrompt(content: unknown): string | undefined {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter((b) => b?.type === 'text' && typeof b.text === 'string')
            .map((b) => b.text as string)
            .join('\n')
        : '';
  const t = text.trim();
  if (!t || t.startsWith('<') || t.startsWith('This session is being continued')) return undefined;
  return t;
}

interface Line {
  type?: string;
  subtype?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  cwd?: string;
  gitBranch?: string;
  message?: { content?: unknown };
}

function scanAssistant(content: unknown, state: SessionState): void {
  if (!Array.isArray(content)) return;
  for (const b of content) {
    if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      state.lastAssistant = clip(b.text, ASSISTANT_CHARS);
    } else if (b?.type === 'tool_use' && b.input && typeof b.input === 'object') {
      const path = (b.input as Record<string, unknown>).file_path;
      if (typeof path !== 'string') continue;
      if (EDIT_TOOLS.has(b.name)) touch(state.filesEdited, path, MAX_FILES);
      else if (b.name === 'Read') touch(state.filesRead, path, MAX_FILES);
    }
  }
}

function scanSpillIds(raw: string, state: SessionState): void {
  for (const m of raw.matchAll(/pakt spilled (sp_[0-9a-f]{16})/g)) {
    if (m[1]) touch(state.spillIds, m[1], MAX_FILES);
  }
}

/**
 * Build the state from a transcript, looking only at entries after the most
 * recent compact boundary (earlier work is already in the previous summary).
 */
export function stateFromTranscript(transcriptPath: string, sessionId: string): SessionState {
  const lines = readFileSync(transcriptPath, 'utf8').split('\n');
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.includes('"subtype":"compact_boundary"')) {
      start = i + 1;
      break;
    }
  }
  const state: SessionState = {
    sessionId,
    takenAt: new Date().toISOString(),
    filesEdited: [],
    filesRead: [],
    recentRequests: [],
    spillIds: [],
  };
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw) continue;
    let x: Line;
    try {
      x = JSON.parse(raw) as Line;
    } catch {
      continue;
    }
    if (x.isSidechain) continue;
    if (x.cwd) state.cwd = x.cwd;
    if (x.gitBranch) state.gitBranch = x.gitBranch;
    if (x.type === 'assistant') scanAssistant(x.message?.content, state);
    else if (x.type === 'user') {
      if (raw.includes('pakt spilled sp_')) scanSpillIds(raw, state);
      if (x.isMeta) continue;
      const prompt = typedPrompt(x.message?.content);
      if (prompt) {
        state.recentRequests.push(clip(prompt, REQUEST_CHARS));
        if (state.recentRequests.length > MAX_REQUESTS) state.recentRequests.shift();
      }
    }
  }
  return state;
}

export function saveState(state: SessionState): string | undefined {
  const path = statePath(state.sessionId);
  if (!path) return undefined;
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  return path;
}

export function loadState(sessionId: string): SessionState | undefined {
  const path = statePath(sessionId);
  if (!path) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SessionState;
  } catch {
    return undefined;
  }
}

const list = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n');

/** Shorten a path for context: relative to cwd, else `~`-relative. Saves re-read tokens. */
function short(path: string, cwd: string | undefined): string {
  if (cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

function shortAll(xs: string[], cwd: string | undefined): string[] {
  return xs.map((x) => short(x, cwd));
}

/**
 * PreCompact stdout: instructions for the summary (Claude Code caps this at
 * 10,000 characters). Tells the summarizer what must survive verbatim and
 * what is safe to drop because it can be re-fetched.
 */
export function compactionInstructions(state: SessionState): string {
  const parts = [
    'PAKT compaction guidance. Keep the summary dense; everything kept is re-read on every later request.',
    'Preserve verbatim: the current goal, decisions made and why, open questions, exact next steps, and any user rules or corrections.',
    'Drop: raw tool output, file contents, logs and diffs (they can be re-read), and errors that were already resolved.',
  ];
  if (state.filesEdited.length)
    parts.push(
      `Files edited this stretch (name them in the summary):\n${list(shortAll(state.filesEdited, state.cwd))}`,
    );
  if (state.spillIds.length) {
    parts.push(
      `Spilled outputs, recoverable with pakt_recall (keep the ids):\n${list(state.spillIds)}`,
    );
  }
  if (state.recentRequests.length)
    parts.push(`Most recent user requests:\n${list(state.recentRequests)}`);
  const text = parts.join('\n\n');
  return text.length > 9500 ? `${text.slice(0, 9499)}…` : text;
}

/**
 * SessionStart(compact) additionalContext. Deliberately small: it sits in
 * the new prefix and is re-read on every request until the next compaction.
 */
export function postCompactContext(state: SessionState): string {
  const parts = ['[pakt] State saved just before compaction:'];
  if (state.cwd) parts.push(`cwd: ${short(state.cwd, undefined)}`);
  if (state.gitBranch) parts.push(`branch: ${state.gitBranch}`);
  if (state.filesEdited.length)
    parts.push(`edited: ${shortAll(state.filesEdited.slice(-12), state.cwd).join(', ')}`);
  if (state.filesRead.length)
    parts.push(`read: ${shortAll(state.filesRead.slice(-8), state.cwd).join(', ')}`);
  if (state.spillIds.length)
    parts.push(`spilled (pakt_recall): ${state.spillIds.slice(-8).join(', ')}`);
  const last = state.recentRequests.at(-1);
  if (last) parts.push(`last request: ${clip(last, 300)}`);
  parts.push('Re-read a file only when you need its current contents.');
  const text = parts.join('\n');
  return text.length > 2000 ? `${text.slice(0, 1999)}…` : text;
}
