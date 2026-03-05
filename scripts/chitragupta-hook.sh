#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# PAKT hook for Chitragupta / shell LLM workflows
#
# Source this file in your .bashrc or .zshrc to get transparent
# PAKT compression for LLM interactions:
#
#   source /path/to/clipforge-PAKT/scripts/chitragupta-hook.sh
#
# Functions provided:
#   pakt_send     - Compress text before sending to an LLM
#   pakt_receive  - Decompress text received from an LLM
#   pakt_llm_call - Full round-trip: compress -> LLM -> decompress
#
# Requirements:
#   - pakt CLI in PATH (npm install -g @sriinnu/pakt)
# ---------------------------------------------------------------------------

# Verify pakt is available
if ! command -v pakt &>/dev/null; then
  echo "[pakt-hook] Warning: 'pakt' CLI not found in PATH." >&2
  echo "[pakt-hook] Install with: npm install -g @sriinnu/pakt" >&2
fi

# ---------------------------------------------------------------------------
# pakt_send - Compress text for LLM input
#
# Usage:
#   pakt_send "your prompt text here"
#   cat file.json | pakt_send
#
# Savings metadata is written to stderr; compressed text to stdout.
# ---------------------------------------------------------------------------
pakt_send() {
  if [ -n "$1" ]; then
    printf '%s\n' "$1" | pakt auto
  else
    # Read from stdin when no argument is provided
    pakt auto
  fi
}

# ---------------------------------------------------------------------------
# pakt_receive - Decompress text from LLM output
#
# Usage:
#   pakt_receive "$llm_response"
#   echo "$response" | pakt_receive
#
# If the input is not PAKT, it passes through unchanged.
# ---------------------------------------------------------------------------
pakt_receive() {
  if [ -n "$1" ]; then
    printf '%s\n' "$1" | pakt auto
  else
    pakt auto
  fi
}

# ---------------------------------------------------------------------------
# pakt_llm_call - Full round-trip compression for LLM calls
#
# Usage:
#   pakt_llm_call "your prompt" [llm_command]
#
# Arguments:
#   $1 - The prompt text to send
#   $2 - The LLM CLI command (default: "llm")
#
# Pipeline:
#   1. Compresses the prompt with pakt_send
#   2. Sends the compressed prompt to the LLM CLI via stdin
#   3. Decompresses the LLM response with pakt_receive
#   4. Prints the final result to stdout
#
# Example:
#   pakt_llm_call "Analyze: $(cat data.json)" "claude"
#   pakt_llm_call "Summarize this CSV: $(cat report.csv)"
# ---------------------------------------------------------------------------
pakt_llm_call() {
  local prompt="${1:?Usage: pakt_llm_call \"prompt\" [llm_command]}"
  local llm_cmd="${2:-llm}"

  # Step 1: Compress the prompt (suppress savings stderr for clean piping)
  local compressed
  compressed=$(pakt_send "$prompt" 2>/dev/null)

  # Step 2: Send to the LLM
  # NOTE: $llm_cmd must be a single command name (not a pipeline or compound
  # command). Arguments are not supported; use a wrapper function instead.
  local raw_response
  raw_response=$(printf '%s\n' "$compressed" | "$llm_cmd")

  # Step 3: Decompress the response (suppress savings stderr)
  printf '%s\n' "$raw_response" | pakt auto 2>/dev/null
}

# ---------------------------------------------------------------------------
# pakt_wrap_file - Compress a file and print to stdout
#
# Usage:
#   pakt_wrap_file data.json
#   pakt_wrap_file response.yaml
#
# Useful for embedding compressed data in prompts:
#   pakt_llm_call "Analyze: $(pakt_wrap_file data.json)"
# ---------------------------------------------------------------------------
pakt_wrap_file() {
  local file="${1:?Usage: pakt_wrap_file <file>}"
  if [ ! -f "$file" ]; then
    echo "[pakt-hook] Error: File not found: $file" >&2
    return 1
  fi
  pakt auto "$file" 2>/dev/null
}
