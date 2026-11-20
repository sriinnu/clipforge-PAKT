/**
 * The browser entry (`src/universal.ts`, the package's `browser` condition)
 * must not reach Node at module scope. The playground worker died on
 * `process is not defined` from 0.10 to 0.13 because the root index re-exported
 * `startProxy`, which pulled `child_process` and the MCP stdio transports.
 * This walks universal.ts's static import graph and fails on any Node import.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../src');
const NODE = /^node:|^(fs|path|os|child_process|crypto|net|tls|stream)$|\/stdio(\.js)?$/;
/**
 * Reviewed Node imports that are only touched inside functions, never at load
 * time, so a browser bundle (where they are stubbed) still loads. A new entry
 * needs the same review: no module-scope call into it.
 */
const ALLOWED = new Set([
  // buildOpenAICacheHints hashes the prefix with createHash on call.
  'middleware/provider-adapter.ts -> node:crypto',
  // pakt_auto dedup keys, hashed per call.
  'mcp/handler-auto.ts -> node:crypto',
  // pakt_stats persistence: paths and writes happen when stats are flushed.
  'stats/persister.ts -> node:crypto',
  'stats/persister.ts -> node:fs',
  'stats/persister.ts -> node:os',
  'stats/persister.ts -> node:path',
  // pakt_recall's file store, reached through the MCP handler; used on recall.
  'spill/file-store.ts -> node:fs',
  'spill/file-store.ts -> node:os',
  'spill/file-store.ts -> node:path',
]);

function resolveLocal(from: string, spec: string): string | undefined {
  const base = join(dirname(from), spec).replace(/\.js$/, '');
  for (const c of [`${base}.ts`, join(base, 'index.ts')]) if (existsSync(c)) return c;
  return undefined;
}

function nodeImports(entry: string): string[] {
  const seen = new Set<string>();
  const hits: string[] = [];
  const walk = (f: string) => {
    if (seen.has(f)) return;
    seen.add(f);
    const text = readFileSync(f, 'utf8');
    // Static value imports and re-exports; `import type` / `export type` are erased.
    for (const m of text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+'([^']+)'/gms)) {
      const spec = m[1] as string;
      if (spec.startsWith('.')) {
        const next = resolveLocal(f, spec);
        if (next) walk(next);
      } else if (NODE.test(spec)) {
        hits.push(`${f.slice(SRC.length + 1)} -> ${spec}`);
      }
    }
  };
  walk(entry);
  return hits.filter((h) => !ALLOWED.has(h));
}

describe('browser entry', () => {
  it('universal.ts reaches no Node module at load time', () => {
    expect(nodeImports(join(SRC, 'universal.ts'))).toEqual([]);
  });

  it('the Node entry does, so the walk is actually looking', () => {
    expect(nodeImports(join(SRC, 'index.ts'))).toEqual(
      expect.arrayContaining(['cli-proxy.ts -> node:child_process']),
    );
  });

  it('package.json sends the browser condition to universal', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
    const dot = pkg.exports['.'];
    expect(Object.keys(dot)[0]).toBe('browser');
    expect(dot.browser.default).toBe('./dist/universal.js');
  });
});
