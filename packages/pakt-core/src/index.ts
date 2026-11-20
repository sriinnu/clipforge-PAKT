/**
 * @sriinnu/pakt — PAKT compression engine (Node entry).
 *
 * Re-exports the runtime-neutral API from `universal.ts` and adds the
 * Node-only pieces: the MCP proxy (spawns child processes, stdio transports)
 * and the file-backed spill store. Bundlers that honour the `browser` export
 * condition get `universal` instead, so a browser or worker build never pulls
 * `child_process` in.
 *
 * @packageDocumentation
 */

export * from './universal.js';

// ---------------------------------------------------------------------------
// Node-only
// ---------------------------------------------------------------------------

export { startProxy } from './cli-proxy.js';
export { FileSpillStore, defaultSpillDir } from './spill/file-store.js';
