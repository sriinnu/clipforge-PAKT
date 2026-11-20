# PAKT for Claude Code

PAKT plugs into Claude Code in four ways:

- **`pakt doctor`** reports where your tokens go.
- Two hooks keep **compaction** from losing your working state.
- A third hook **spills** long Bash output out of the context window.
- An **MCP server** lets the model pull spilled text back with `pakt_recall`.

Everything runs locally, and none of it edits your Claude Code settings for you.

```bash
npm install -g @sriinnu/pakt
```

## `pakt doctor`: where the tokens go

```bash
pakt doctor              # last 30 days
pakt doctor --days 7
pakt doctor --json
pakt doctor ribhu        # same idea for Ribhu's usage log (~/.ribhu/usage)
```

The doctor reads the transcripts Claude Code writes under `~/.claude/projects`, covering both main sessions and `<session>/subagents/`. It reports aggregates only; prompt and tool content never leave the parser. Cost is measured in *input-token units* relative to the model's base input price:

| Bucket | Weight |
|---|---|
| Uncached input | 1 |
| Cache read | 0.1 |
| Cache write, 5 minutes | 1.25 |
| Cache write, 1 hour | 2 |
| Output | 5 |

These ratios hold across current Claude models, so shares and before/after deltas are meaningful without a price table. The report:

- splits cost across the buckets above;
- finds cache rewrites that happen after idle gaps (the prompt cache expired);
- simulates `CLAUDE_CODE_AUTO_COMPACT_WINDOW` values to show what a different compaction window would have cost;
- lists the tool results that stay resident in context longest.

Its recommendations are proposals. Nothing changes until you apply them yourself.

## Compaction that keeps your state

When Claude Code compacts, the summary can drop exactly what you need next: which files you were in, what you just asked for, and which outputs were spilled. Two hooks cover that:

- **`pre-compact`** tells the summariser what to keep.
- **`session-start`** with matcher `compact` re-injects a snapshot after compaction: files edited and read, your recent requests, the last reply, and any spill ids.

Snapshots live in `~/.pakt/state` (override with `PAKT_STATE_DIR`), with files at mode 0600.

## Bash spill

A long build log or test run sits in context for the rest of the session and is re-read on every request. The **`post-tool-use`** hook (matcher `Bash`) replaces a long, successful output with its first and last lines plus a marker:

```text
[pakt spilled sp_2f53b83c5f91d69f: 4128 tokens, 264 lines, 234 middle lines not shown. Full text: pakt_recall {"id":"sp_2f53b83c5f91d69f"}]
```

The full text stays on your machine in `~/.pakt/spill` (override with `PAKT_SPILL_DIR`), with files at mode 0600. The model calls `pakt_recall` when it needs the middle.

**It never spills** non-Bash tools (including `pakt_recall` itself), images, interrupted commands, output with stderr, or anything that looks like an error (compiler diagnostics, test failures, stack traces). Failures always reach the model in full.

When Claude Code has already cut the output at its own `BASH_MAX_OUTPUT_LENGTH` (default 30000 chars), the hook can't see the real end. So it keeps the head lines only, adds no tail, and appends a note telling the model to re-run with a filter (`| tail -n 50`, `| grep`) to see the end.

| Variable | Default | Range | Meaning |
|---|---|---|---|
| `PAKT_SPILL_MODE` | `shadow` | `shadow` / `live` / `off` | `shadow` only records what it would have spilled; `live` rewrites the output; `off` does nothing |
| `PAKT_SPILL_THRESHOLD` | 1000 | 200–50000 | Spill outputs above this many tokens |
| `PAKT_SPILL_HEAD` | 15 | 0–200 | Lines kept from the start |
| `PAKT_SPILL_TAIL` | 15 | 0–200 | Lines kept from the end |

Every decision, including those made in shadow mode, is appended to `~/.pakt/ledger/spill.jsonl` (override with `PAKT_LEDGER_DIR`). The ledger records sizes and ids only, never content.

**Why shadow is the default:** `live` also rewrites output that a script consumes, not just output the model reads. A command whose stdout is parsed (`git status --porcelain`, a `--json` flag, a REPL script reading a result) gets the gist instead of the data. Run shadow for a while, check the ledger, and switch to `live` only if your sessions are mostly read-only output.

To see exactly what the hook would hand the model, paste an output into the **Bash Spill** tab of the [playground](../apps/playground). It runs the same `spill()` with the same defaults, entirely in your browser.

## Setup

Add the hooks to `~/.claude/settings.json`, or to a project's `.claude/settings.json`:

```json
{
  "hooks": {
    "PreCompact": [{ "hooks": [{ "type": "command", "command": "pakt hook pre-compact", "timeout": 10 }] }],
    "SessionStart": [{ "matcher": "compact", "hooks": [{ "type": "command", "command": "pakt hook session-start", "timeout": 5 }] }],
    "PostToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "pakt hook post-tool-use", "timeout": 5 }] }]
  },
  "env": { "PAKT_SPILL_MODE": "shadow" }
}
```

Then add the MCP server, so the model can call `pakt_recall` (plus the compression tools):

```bash
claude mcp add pakt -- pakt serve --stdio
```

Hook and env changes take effect in **new** sessions.

## Files at a glance

| Path | What | Override |
|---|---|---|
| `~/.pakt/state` | Compaction snapshots | `PAKT_STATE_DIR` |
| `~/.pakt/spill` | Full text of spilled outputs | `PAKT_SPILL_DIR` |
| `~/.pakt/ledger/spill.jsonl` | Spill decisions (sizes and ids only) | `PAKT_LEDGER_DIR` |
