# pakt-client

**Thin Python client for the PAKT CLI / MCP server. The compression engine runs in Node (>= 22). This is a wrapper, not a port.**

[PAKT](https://github.com/sriinnu/clipforge-PAKT) is a lossless, model-free prompt-compression engine for LLM payloads (JSON, YAML, CSV, Markdown, mixed text). The engine ships as the npm package [`@sriinnu/pakt`](https://www.npmjs.com/package/@sriinnu/pakt); this package lets Python agent builders call it through its two language-agnostic surfaces:

- **CLI mode** (`PaktCli`) — shells out to `pakt compress/decompress/auto/inspect/stats/tokens/detect` with stdin piping. Zero Python dependencies (stdlib `subprocess` + `json`).
- **MCP mode** (`PaktMcp`, *experimental*) — spawns `pakt serve --stdio` and speaks newline-delimited JSON-RPC 2.0 to the `pakt_compress` / `pakt_auto` / `pakt_inspect` / `pakt_stats` tools. Also stdlib-only: the MCP stdio subset PAKT needs is simple enough that the official `mcp` SDK is not required (it's available as the optional `pakt-client[mcp]` extra if you want it for your own wiring; this package never imports it).

No compression logic is reimplemented in Python. If you want a real port, read the [polyglot port options research](../../docs/research/2026-06-polyglot-port-options.md).

## Prerequisites

```bash
npm i -g @sriinnu/pakt   # requires Node.js >= 22
```

## Install

```bash
pip install pakt-client            # zero runtime deps
pip install 'pakt-client[mcp]'     # + official MCP SDK (optional, not used internally)
```

## CLI mode

```python
from pakt_client import PaktCli

pakt = PaktCli()  # discovers the binary, see below

result = pakt.compress({"users": [{"id": 1, "name": "Alice", "role": "admin"}]})
result.compressed         # PAKT text -> paste into your prompt
result.original_tokens    # parsed from the CLI's stderr stat line
result.saved_tokens

restored = pakt.decompress(result.compressed, to_format="json")

report = pakt.inspect(big_payload)          # InspectResult (format, tokens, recommendation)
n = pakt.tokens(big_payload, model="claude-sonnet")
stats = pakt.stats(big_payload)             # single-shot StatsResult incl. cost estimate
auto = pakt.auto(anything)                  # compress raw / decompress PAKT, auto-detected
```

### Options → CLI flags

| `compress()` / `auto()` kwarg | CLI flag | Notes |
| --- | --- | --- |
| `from_format="json"` | `--from json` | json \| yaml \| csv \| md \| text. Implied for dict/list inputs. |
| `to_format="json"` | `--to json` | decompress / auto only |
| `layers=[1, 2]` | `--layers 1,2` | 1 structural, 2 dictionary, 3 tokenizer, 4 semantic, 5 content |
| `semantic_budget=120` | `--semantic-budget 120` | opt-in **lossy** L4 |
| `pii_mode="redact"` | `--pii-mode redact` | off \| flag \| redact |
| `pii_kinds=["email", "jwt"]` | `--pii-kinds email,jwt` | |
| `pii_reversible=True` | `--pii-reversible` | |
| `model="gpt-4o"` (inspect/tokens/stats) | `--model gpt-4o` | token counting / cost model |

### Binary discovery

First match wins:

1. `PaktCli(binary=...)` — path string or argv list (e.g. `["node", ".../dist/cli.js"]`)
2. `PAKT_BIN` env var — shell-split, so `export PAKT_BIN="node /repo/packages/pakt-core/dist/cli.js"` works
3. `npx -y @sriinnu/pakt` when `npx` is on PATH (resolves local/global/cached installs; first call may download)
4. `pakt` on PATH

Otherwise `PaktNotFoundError` is raised with install instructions.

### Honest caveat: text parsing

The pakt CLI 0.10.x emits **human-readable text, not JSON** for most commands — verified against `cli-commands.ts` and the built CLI. `inspect()`, `stats()`, and `detect()` therefore parse the stable `Key: value` layout, and `compress()`/`auto()` parse the fixed stderr stat lines. If the layout ever changes, you get a loud `PaktParseError` carrying the raw output — never silently wrong numbers. For natively structured results, use MCP mode.

> **`stats --json` status:** The flag is fully implemented from **0.11.0** and emits a `schemaVersion: 1` JSON object to stdout. `PaktCli.stats()` still parses the `Key: value` text path for backward compatibility with 0.10.x installs. A future version may prefer the `--json` output directly.

## MCP mode (experimental)

```python
from pakt_client import PaktMcp

with PaktMcp(agent_name="my-agent") as pakt:
    r = pakt.compress('{"a": 1, "b": 2}')      # pakt_compress -> CompressResult
    r.format, r.reversible, r.saved_tokens      # full structured fields

    a = pakt.auto(r.compressed)                 # pakt_auto -> AutoResult
    i = pakt.inspect("...")                     # pakt_inspect -> InspectResult
    s = pakt.stats(scope="session")             # pakt_stats -> SessionStats

    raw = pakt.call_tool("pakt_explain", {"text": "..."})  # any pakt_* tool, raw dict
```

MCP tool options use the contract's camelCase names (`semanticBudget`, `piiMode`, ...). Result dataclasses mirror the tool contracts in `packages/pakt-core/src/mcp/contract.ts` 1:1 (camelCase → snake_case); "JSON object string" fields are parsed into dicts.

## Development in this monorepo

```bash
cd packages/pakt-core && pnpm build        # produces dist/cli.js
cd ../pakt-python
export PAKT_BIN="node $(pwd)/../pakt-core/dist/cli.js"   # optional; tests find dist/ automatically
python -m pytest tests                     # integration tests skip when no CLI is found
```

Tests: unit tests (discovery, arg building, output parsing — no Node needed) plus `-m integration` tests that round-trip real payloads through the dist CLI and the MCP stdio server.

## License

MIT — same as the PAKT monorepo.
