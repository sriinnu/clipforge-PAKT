/**
 * @module hooks
 * Claude Code hook handlers behind `pakt hook <event>`.
 *
 * Contract with Claude Code: the hook reads one JSON object on stdin and may
 * write to stdout. Every handler **fails open**: on any error it prints
 * nothing and exits 0, so a PAKT bug can never block a tool call, a prompt
 * or a compaction.
 *
 *   pre-compact    save session state; stdout = summary instructions
 *   session-start  on source "compact", re-inject the saved state
 *
 * @internal Node.js only.
 */

import {
  compactionInstructions,
  loadState,
  postCompactContext,
  saveState,
  stateFromTranscript,
} from './state.js';

export type HookEvent = 'pre-compact' | 'session-start';
export const HOOK_EVENTS: readonly HookEvent[] = ['pre-compact', 'session-start'];

export interface HookResult {
  /** Text for stdout; empty for no output. */
  stdout: string;
}

interface HookInput {
  session_id?: string;
  transcript_path?: string;
  source?: string;
  trigger?: string;
}

const NONE: HookResult = { stdout: '' };

function preCompact(input: HookInput): HookResult {
  if (!input.session_id || !input.transcript_path) return NONE;
  const state = stateFromTranscript(input.transcript_path, input.session_id);
  saveState(state);
  return { stdout: compactionInstructions(state) };
}

function sessionStart(input: HookInput): HookResult {
  if (input.source !== 'compact' || !input.session_id) return NONE;
  const state = loadState(input.session_id);
  if (!state) return NONE;
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: postCompactContext(state),
      },
    }),
  };
}

/** Run one hook. Never throws. */
export function runHook(event: string, stdin: string): HookResult {
  try {
    const input = JSON.parse(stdin) as HookInput;
    if (event === 'pre-compact') return preCompact(input);
    if (event === 'session-start') return sessionStart(input);
    return NONE;
  } catch {
    return NONE;
  }
}
