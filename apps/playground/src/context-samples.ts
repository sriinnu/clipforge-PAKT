import type { ContextDemoMessage } from './pakt-runtime';

/** A named demo conversation for the Context Engine view. */
export interface ContextSample {
  id: string;
  label: string;
  description: string;
  /** A query to pre-fill when the extractive layer is toggled on. */
  suggestedQuery?: string;
  messages: ContextDemoMessage[];
}

const IMPORT_A = 'import { Logger } from "./logger";';
const IMPORT_B = 'import { db } from "./db";';

/** ~30 mostly-noise log lines with two that mention the incident. */
function noisyLog(): string {
  const lines: string[] = [];
  for (let i = 0; i < 14; i++) {
    lines.push(
      `2026-06-30T09:${String(10 + i).padStart(2, '0')}:00Z INFO gateway heartbeat ok seq=${i}`,
    );
  }
  lines.push(
    '2026-06-30T09:24:01Z ERROR payment-service charge declined for order INV-9001 (HTTP 500)',
  );
  for (let i = 0; i < 9; i++) {
    lines.push(
      `2026-06-30T09:${String(25 + i).padStart(2, '0')}:00Z INFO gateway heartbeat ok seq=${20 + i}`,
    );
  }
  lines.push('2026-06-30T09:34:12Z WARN payment-service retry scheduled for order INV-9001');
  for (let i = 0; i < 6; i++) {
    lines.push(
      `2026-06-30T09:${String(35 + i).padStart(2, '0')}:00Z INFO gateway heartbeat ok seq=${40 + i}`,
    );
  }
  return lines.join('\n');
}

export const CONTEXT_SAMPLES: ContextSample[] = [
  {
    id: 'refactor',
    label: 'Agentic refactor — shared lines + code',
    description:
      'Three files read in a row share the same import header and carry comments. The cross-message @shared dictionary aliases the repeated lines once; opt-in code compaction strips comments from the older reads.',
    messages: [
      {
        role: 'user',
        content: 'Refactor the auth module to use the shared logger and db helpers.',
      },
      {
        role: 'tool',
        toolName: 'read_file',
        content: `${IMPORT_A}\n${IMPORT_B}\n\n// authenticate a user by their session token\nexport async function authenticate(token) {\n  // look up the active session\n  const s = await db.sessions.find(token);\n  if (!s) throw new Error("no session");\n  return s.user;\n}`,
      },
      {
        role: 'assistant',
        content: 'auth.ts already uses the helpers. Reading the user module next.',
      },
      {
        role: 'tool',
        toolName: 'read_file',
        content: `${IMPORT_A}\n${IMPORT_B}\n\n// load a single user record by id\nexport async function loadUser(id) {\n  // query the users table\n  const u = await db.users.find(id);\n  if (!u) throw new Error("not found");\n  return u;\n}`,
      },
      { role: 'assistant', content: 'Now the sessions helper.' },
      {
        role: 'tool',
        toolName: 'read_file',
        content: `${IMPORT_A}\n${IMPORT_B}\n\n// list every active session\nexport function activeSessions() {\n  // filter on the active flag\n  return db.sessions.where({ active: true });\n}`,
      },
      { role: 'user', content: 'Good. Make loadUser log a warning when the user is missing.' },
      { role: 'assistant', content: 'I will add Logger.warn before the throw in loadUser.' },
      { role: 'user', content: 'Then run the tests.' },
    ],
  },
  {
    id: 'logs',
    label: 'Log triage — extractive selection',
    description:
      'A noisy gateway log was pulled early in the session. With a query set and the extractive layer on, only the lines relevant to the incident are kept; the rest collapse into an elision marker. Recent turns stay verbatim.',
    suggestedQuery: 'order INV-9001 checkout 500 error',
    messages: [
      { role: 'user', content: 'Checkout returns 500 for order INV-9001. Pull the gateway logs.' },
      { role: 'tool', toolName: 'read_logs', content: noisyLog() },
      {
        role: 'assistant',
        content: 'Two relevant lines: a declined charge and a retry for INV-9001.',
      },
      { role: 'user', content: 'Which service raised it?' },
      { role: 'assistant', content: 'payment-service, on the charge step.' },
      { role: 'user', content: 'Check whether it is still happening now.' },
    ],
  },
];
