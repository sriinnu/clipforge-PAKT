# Polyglot port options for PAKT (June 2026)

Context: `pakt-client` (Python) ships as a thin wrapper over the Node engine's CLI/MCP
surfaces. This doc evaluates the real long-term options for serving non-JS ecosystems,
so the wrapper decision is a documented choice, not an accident.

## The constraint that shapes everything: the tokenizer

PAKT's L3 layer and all savings accounting depend on exact token counts from
[`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer) (a JS implementation of
OpenAI's BPE encodings, same ranks as `tiktoken`). Any port needs a tokenizer story:

- **Rust**: `tiktoken` itself has a Rust core (OpenAI ships it as Rust + PyO3 bindings);
  community crates (`tiktoken-rs`) and Hugging Face's `tokenizers` crate cover the same
  encodings. Token counts match because the BPE rank data is shared — drift risk is low.
- **Python**: `tiktoken` (PyPI) is first-party and battle-tested.
- The Claude-model counts in pakt-core are approximations layered on the same encodings,
  so a port must replicate pakt-core's approximation logic, not just the BPE.

## Options

### (a) Rust core + bindings (pyo3 → PyPI, napi-rs/wasm-bindgen → npm)

Rewrite L1–L5 in Rust once; emit native wheels (PyO3/maturin), an npm package
(napi-rs or wasm-bindgen), and a C ABI for everyone else. This is the proven
"one core, many languages" pattern: `pydantic-core`, `tiktoken`, and Hugging Face
`tokenizers` (Rust core with Python *and* Node bindings) all ship exactly this shape.
Fits the repo convention ("rust for backend").

- **Perf**: best of all options; no subprocess, no Node startup (~100–300 ms per cold CLI call today).
- **Maintenance drift**: eliminated *after* migration — but the migration itself is a full
  engine rewrite (parsers, 5 layers, PII, reverse pipeline) plus golden-vector parity tests,
  and the TS engine must either freeze or become a binding consumer too.
- **Packaging weight**: wheels per platform/Python; maturin + CI matrix is well-trodden but real work.
- **Cost**: weeks of focused work; highest payoff only if PAKT's compression core stabilizes.

### (b) WASM build consumed from Python via wasmtime

The engine is TypeScript — there is no direct TS→WASM compiler worth shipping. The honest
routes are: (1) embed the JS engine in WASM (Shopify's Javy bundles QuickJS into a .wasm),
or (2) write the core in Rust/AssemblyScript first — which collapses into option (a) with a
wasm-bindgen target. Route (1) means shipping a JS interpreter + the multi-MB BPE rank data
inside a module interpreted via `wasmtime-py`: large artifact, interpreter-grade speed,
two runtimes' worth of debugging. Sandboxing is the only real win, and PAKT doesn't need it.
**Not recommended as a primary path; reasonable as a *target* of (a).**

### (c) Pure-Python L1-only port

Port just structural compression (L1) plus the PAKT serializer; use `tiktoken` for counts.
Smallest piece of real value (L1 does the bulk of savings on tabular JSON), pip-installable,
no Node. But: two engines diverge from day one (format evolution, edge cases, bug-for-bug
parity), savings numbers stop matching the TS engine, and "PAKT" stops meaning one format
unless a conformance suite gates both. History is unkind to partial ports — they rot the
moment the reference engine moves. Only worth it with shared golden test vectors in CI and
a clearly versioned format spec. **High drift risk for partial value.**

### (d) Status quo: protocol surfaces (CLI + MCP) with thin clients

What `pakt-client` does today. One engine, zero reimplementation, zero drift; a thin client
per language is ~500 lines and mostly tests. Costs: a Node >= 22 runtime requirement on the
consumer's machine, subprocess startup per CLI call (amortized to near-zero by keeping the
MCP stdio server warm), and text-parsing fragility for the CLI commands that don't emit JSON
(0.10.0 has none — `stats --json` is advertised in help but unimplemented; worth fixing upstream).

## Recommendation

**(d) now, (a) when demand proves out — and skip (b)/(c).**

Stay on protocol surfaces while the format and layers are still moving (0.x). The wrapper is
honest, cheap, and the MCP server already amortizes process startup. Two low-cost upstream
improvements would harden it: implement `--json` output in the CLI (the help already promises
it), and publish format golden vectors. If/when Python demand justifies native speed, do the
Rust core with pyo3 + napi-rs/wasm-bindgen bindings — the tiktoken/pydantic-core/tokenizers
precedent shows the packaging path is solved, the tokenizer story is solved (`tiktoken-rs`),
and the same core then replaces the TS engine instead of competing with it. That ordering
means the rewrite happens once, against a stable spec, instead of chasing a moving one.
