#!/usr/bin/env node
/**
 * Epoch replay: when is a gist cache-safe?
 *
 * Replays Claude Code transcripts (JSONL) and prices every request with a
 * prefix-cache model (cache read 0.1x, cache write 1.25x, warm 5-min cache).
 * Unlike cache-replay.mjs, every mode here is append-only between epochs, so
 * the cost is O(1) per request and large sessions do not OOM.
 *
 * Modes:
 *   none           raw history, never compacted (old baseline, unrealistic
 *                  past the context window)
 *   compact        raw, checkpoint gist: when history > --trigger tokens the
 *                  whole history is replaced by a --gist-token summary
 *                  (what Claude Code /compact and server compaction do)
 *   pakt           + each tool result compressed once with compressMixed on
 *                  append (kept only if smaller); never rewritten
 *   spill          + tool results over --spill tokens replaced on append by
 *                  their first lines and a pointer (Inline & Spill)
 *   spill-recall   spill, but every --recall-every'th spilled result is fetched
 *                  back in full on the next request (recall cost)
 *   pakt+spill     both
 *
 * A compaction request is priced as a cache read of the whole history (the
 * summarising call); its output tokens are ignored. Gists are synthetic: this
 * measures cost, not what a lossy gist does to answer quality.
 *
 * Usage: node scripts/eval/cache-epochs.mjs <session.jsonl>... [--json]
 *          [--trigger 150000] [--gist 4000] [--spill 2000] [--recall-every 4]
 * Local only. Prints aggregate numbers, never transcript content.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { compressMixed, countTokens } from '../../packages/pakt-core/dist/index.js';

const READ = 0.1;
const WRITE = 1.25;

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : dflt;
};
const TRIGGER = flag('trigger', 150_000);
const GIST = flag('gist', 4_000);
const SPILL = flag('spill', 2_000);
const RECALL_EVERY = flag('recall-every', 4);
const SPILL_HEAD_LINES = 20;
const asJson = argv.includes('--json');
const files = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));

const MODES = {
  none: { compact: false },
  compact: { compact: true },
  pakt: { compact: true, pakt: true },
  spill: { compact: true, spill: true },
  'spill-recall': { compact: true, spill: true, recall: true },
  'pakt+spill': { compact: true, pakt: true, spill: true },
};

function toText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b.type === 'text' ? b.text : b.type === 'image' ? '[image]' : ''))
    .join('\n');
}

/** Ordered events: { kind: 'msg', text, tool: bool } and { kind: 'request' }. */
function loadEvents(path) {
  const events = [];
  let lastRequestId = null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
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
      if (typeof content === 'string') events.push({ kind: 'msg', text: content, tool: false });
      else if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type === 'tool_result')
            events.push({ kind: 'msg', text: toText(b.content), tool: true });
          else if (b.type === 'text') events.push({ kind: 'msg', text: b.text, tool: false });
        }
      }
    } else if (x.type === 'assistant' && Array.isArray(content)) {
      if (x.requestId !== lastRequestId) {
        events.push({ kind: 'request' });
        lastRequestId = x.requestId;
      }
      for (const b of content) {
        if (b.type === 'text') events.push({ kind: 'msg', text: b.text, tool: false });
        if (b.type === 'tool_use') {
          events.push({
            kind: 'msg',
            text: `[tool_use ${b.name}] ${JSON.stringify(b.input)}`,
            tool: false,
          });
        }
      }
    }
  }
  return events;
}

/** Precompute per-message token counts for every variant once per session. */
function prepare(events) {
  for (const ev of events) {
    if (ev.kind !== 'msg') continue;
    ev.raw = countTokens(ev.text);
    ev.pakt = ev.raw;
    if (ev.tool && ev.raw > 50) {
      try {
        const c = countTokens(compressMixed(ev.text).compressed);
        if (c < ev.raw) ev.pakt = c;
      } catch {}
    }
    ev.head = ev.raw;
    if (ev.tool && ev.raw > SPILL) {
      const head = ev.text.split('\n').slice(0, SPILL_HEAD_LINES).join('\n').slice(0, 4000);
      ev.head = countTokens(`${head}\n[spilled id=t0000 ${ev.raw} tokens; recall by id]`);
    }
    ev.text = null; // free the string; only counts are needed from here on
  }
}

function replay(events, mode) {
  const out = { requests: 0, cost: 0, sentTokens: 0, compactions: 0, spilled: 0, recalled: 0 };
  let cached = 0; // tokens of the prefix sent last request (all cacheable)
  let pending = 0; // tokens appended since last request
  let spillCount = 0;
  let recallQueue = 0;
  for (const ev of events) {
    if (ev.kind === 'msg') {
      let t = ev.raw;
      if (mode.pakt) t = ev.pakt;
      if (mode.spill && ev.tool && ev.raw > SPILL) {
        t = mode.pakt ? Math.min(ev.head, ev.pakt) : ev.head;
        out.spilled++;
        spillCount++;
        if (mode.recall && spillCount % RECALL_EVERY === 0)
          recallQueue += mode.pakt ? ev.pakt : ev.raw;
      }
      pending += t;
      continue;
    }
    // request: recalled content arrives as a new tool result before this call
    if (recallQueue) {
      pending += recallQueue;
      out.recalled++;
      recallQueue = 0;
    }
    if (mode.compact && cached + pending > TRIGGER) {
      // summarising call reads the whole (cached) history, then the epoch restarts
      out.cost += (cached + pending) * READ;
      out.compactions++;
      cached = 0;
      pending = GIST;
    }
    out.requests++;
    out.sentTokens += cached + pending;
    out.cost += cached * READ + pending * WRITE;
    cached += pending;
    pending = 0;
  }
  return out;
}

if (files.length === 0) {
  console.error('usage: node scripts/eval/cache-epochs.mjs <session.jsonl>... [--json]');
  process.exit(2);
}

const keys = ['requests', 'cost', 'sentTokens', 'compactions', 'spilled', 'recalled'];
const totals = Object.fromEntries(
  Object.keys(MODES).map((m) => [m, Object.fromEntries(keys.map((k) => [k, 0]))]),
);
const perFile = [];
for (const f of files) {
  const events = loadEvents(f);
  if (!events.some((e) => e.kind === 'request')) continue;
  prepare(events);
  const row = { file: basename(f) };
  for (const [name, mode] of Object.entries(MODES)) {
    row[name] = replay(events, mode);
    for (const k of keys) totals[name][k] += row[name][k];
  }
  perFile.push(row);
}

if (asJson) {
  console.log(
    JSON.stringify({ params: { TRIGGER, GIST, SPILL, RECALL_EVERY }, totals, perFile }, null, 2),
  );
} else {
  const base = totals.compact.cost;
  console.log(`sessions ${perFile.length}, requests ${totals.none.requests}; baseline = compact`);
  for (const [m, t] of Object.entries(totals)) {
    const c = ((t.cost / base - 1) * 100).toFixed(1).padStart(7);
    console.log(`${m.padEnd(13)} cost ${c}%  compactions ${t.compactions}  spilled ${t.spilled}`);
  }
}
