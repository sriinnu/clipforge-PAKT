#!/usr/bin/env node
/**
 * Cache-replay harness: does the ContextEngine save money once Claude's
 * prompt cache and preserved-thinking check are taken into account?
 *
 * Replays Claude Code session transcripts (JSONL) request by request through
 * three modes and prices each request with a prefix-cache model:
 *
 *   none         - history sent verbatim (what the agent does without PAKT)
 *   rewrite      - ContextEngine default config, optimize() every request
 *   append-only  - approximation: tool results compressed once on append,
 *                  history never rewritten (@shared off, minimal strategy,
 *                  no aging, no budget pressure)
 *
 * Per request: tokens in the leading messages byte-identical to the previous
 * request are cache reads (0.1x); everything else is a cache write (1.25x,
 * 5-minute TTL). `thinkingBreaks` counts requests where an already-sent
 * message changed, which on Fable 5.2 invalidates every later thinking block.
 *
 * Caveats (also printed): token counts use PAKT's default gpt-4o tokenizer,
 * so compare ratios, not absolutes; system prompt and tools are excluded
 * (identical across modes, so absolute savings are overstated as a share of
 * the full request); thinking blocks are not replayed.
 *
 * Usage: node scripts/eval/cache-replay.mjs <session.jsonl>... [--json]
 * Local only. Prints aggregate numbers, never transcript content.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { countTokens, createContextEngine } from '../../packages/pakt-core/dist/index.js';

const READ = 0.1;
const WRITE = 1.25;

const MODES = {
  none: null,
  rewrite: {},
  'append-only': {
    sharedDictionary: false,
    strategy: 'minimal',
    toolResultTailLines: 0,
    maxContextTokens: 1_000_000_000,
  },
};

/** Flatten a tool_result / message content value to text. */
function toText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b.type === 'text' ? b.text : b.type === 'image' ? '[image]' : ''))
    .join('\n');
}

/**
 * Turn a transcript into an ordered event list:
 * { kind: 'user' | 'assistant' | 'tool', name?, text } plus 'request'
 * markers where the agent called the API.
 */
function loadEvents(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const events = [];
  const toolNames = new Map();
  let lastRequestId = null;
  for (const line of lines) {
    if (!line) continue;
    let x;
    try {
      x = JSON.parse(line);
    } catch {
      continue;
    }
    if (x.isSidechain || !x.message) continue;
    const content = x.message.content;
    if (x.type === 'user') {
      if (typeof content === 'string') {
        events.push({ kind: 'user', text: content });
      } else if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type === 'tool_result') {
            events.push({
              kind: 'tool',
              name: toolNames.get(b.tool_use_id) ?? 'tool',
              text: toText(b.content),
            });
          } else if (b.type === 'text') {
            events.push({ kind: 'user', text: b.text });
          }
        }
      }
    } else if (x.type === 'assistant' && Array.isArray(content)) {
      if (x.requestId !== lastRequestId) {
        events.push({ kind: 'request' });
        lastRequestId = x.requestId;
      }
      for (const b of content) {
        if (b.type === 'text') events.push({ kind: 'assistant', text: b.text });
        if (b.type === 'tool_use') {
          toolNames.set(b.id, b.name);
          events.push({
            kind: 'assistant',
            text: `[tool_use ${b.name}] ${JSON.stringify(b.input)}`,
          });
        }
      }
    }
  }
  return events;
}

const tokenCache = new Map();
function tokens(s) {
  let n = tokenCache.get(s);
  if (n === undefined) {
    n = countTokens(s);
    tokenCache.set(s, n);
  }
  return n;
}

function replay(events, config) {
  const engine = config ? createContextEngine(config) : null;
  const raw = [];
  let prev = null;
  const out = {
    requests: 0,
    cost: 0,
    readTokens: 0,
    writeTokens: 0,
    thinkingBreaks: 0,
    sentTokens: 0,
  };

  for (const ev of events) {
    if (ev.kind === 'request') {
      const msgs = engine
        ? engine.optimize().messages.map((m) => `${m.role}\u0000${m.content}`)
        : raw.slice();
      let common = 0;
      if (prev)
        while (common < prev.length && common < msgs.length && prev[common] === msgs[common])
          common++;
      if (prev && common < prev.length) out.thinkingBreaks++;
      let read = 0;
      let write = 0;
      for (let i = 0; i < msgs.length; i++) {
        if (i < common) read += tokens(msgs[i]);
        else write += tokens(msgs[i]);
      }
      out.requests++;
      out.readTokens += read;
      out.writeTokens += write;
      out.sentTokens += read + write;
      out.cost += read * READ + write * WRITE;
      prev = msgs;
      continue;
    }
    const role = ev.kind === 'tool' ? 'tool' : ev.kind;
    if (engine) {
      if (ev.kind === 'tool') engine.addToolResult(ev.name, ev.text);
      else engine.addMessage({ role, content: ev.text });
    }
    raw.push(`${role}\u0000${ev.text}`);
  }
  return out;
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const files = args.filter((a) => a !== '--json');
if (files.length === 0) {
  console.error('usage: node scripts/eval/cache-replay.mjs <session.jsonl>... [--json]');
  process.exit(2);
}

const totals = Object.fromEntries(
  Object.keys(MODES).map((m) => [m, { requests: 0, cost: 0, sentTokens: 0, thinkingBreaks: 0 }]),
);
const perFile = [];
for (const f of files) {
  tokenCache.clear(); // per-session: keeping every session's strings OOMs on big runs
  const events = loadEvents(f);
  if (!events.some((e) => e.kind === 'request')) continue;
  const row = { file: basename(f) };
  for (const [mode, cfg] of Object.entries(MODES)) {
    const r = replay(events, cfg);
    row[mode] = r;
    for (const k of Object.keys(totals[mode])) totals[mode][k] += r[k];
  }
  perFile.push(row);
}

if (asJson) {
  console.log(JSON.stringify({ totals, perFile }, null, 2));
} else {
  const base = totals.none.cost;
  console.log(`sessions: ${perFile.length}, requests: ${totals.none.requests}`);
  console.log('mode          eff.cost vs none   sent tokens vs none   requests breaking prefix');
  for (const [mode, t] of Object.entries(totals)) {
    const c = ((t.cost / base - 1) * 100).toFixed(1).padStart(6);
    const s = ((t.sentTokens / totals.none.sentTokens - 1) * 100).toFixed(1).padStart(6);
    console.log(
      `${mode.padEnd(13)} ${c}%            ${s}%               ${t.thinkingBreaks}/${t.requests}`,
    );
  }
  console.log(
    '\nnotes: gpt-4o tokenizer (compare ratios); system+tools excluded; thinking blocks not replayed.',
  );
}
