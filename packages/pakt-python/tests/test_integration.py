"""Integration tests against a real pakt CLI / MCP server.

Skipped automatically when no runnable CLI is found (see conftest.find_dev_pakt).
Dev path in this monorepo: build pakt-core (`pnpm build`), then these tests run
against `node packages/pakt-core/dist/cli.js`. Or: `export PAKT_BIN=...`.
"""

from __future__ import annotations

import json

import pytest

from pakt_client import PaktCli, PaktMcp

from conftest import PAKT_AVAILABLE

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not PAKT_AVAILABLE, reason="pakt CLI not available"),
]

PAYLOAD = {
    "users": [
        {"id": 1, "name": "Alice", "role": "admin"},
        {"id": 2, "name": "Bob", "role": "user"},
        {"id": 3, "name": "Carol", "role": "user"},
    ]
}


def test_cli_round_trip_json(pakt_bin: list[str]) -> None:
    """compress -> decompress restores semantically identical JSON."""
    cli = PaktCli(binary=pakt_bin)

    compressed = cli.compress(PAYLOAD)
    assert compressed.compressed.startswith("@from json")
    assert compressed.original_tokens is not None
    assert compressed.compressed_tokens is not None
    assert compressed.saved_tokens == (
        compressed.original_tokens - compressed.compressed_tokens
    )

    restored = cli.decompress(compressed.compressed, to_format="json")
    assert json.loads(restored) == PAYLOAD


def test_cli_inspect_and_tokens(pakt_bin: list[str]) -> None:
    """inspect detects JSON and tokens returns a positive count."""
    cli = PaktCli(binary=pakt_bin)
    text = json.dumps(PAYLOAD)

    inspected = cli.inspect(text)
    assert inspected.detected_format == "json"
    assert inspected.input_tokens > 0
    assert inspected.recommended_action in {"compress", "decompress", "leave-as-is"}

    assert cli.tokens(text) > 0


def test_cli_stats_single_shot(pakt_bin: list[str]) -> None:
    """Single-shot stats reports consistent token accounting."""
    cli = PaktCli(binary=pakt_bin)
    stats = cli.stats(PAYLOAD)
    assert stats.format == "json"
    assert stats.saved_tokens == stats.input_tokens - stats.output_tokens


def test_cli_version(pakt_bin: list[str]) -> None:
    """--version returns a semver-ish string."""
    version = PaktCli(binary=pakt_bin).version()
    assert version[0].isdigit()


def test_mcp_compress_and_auto_round_trip(pakt_bin: list[str]) -> None:
    """MCP stdio: handshake, pakt_compress, then pakt_auto decompresses."""
    with PaktMcp(binary=pakt_bin, agent_name="pakt-client-tests") as mcp:
        assert mcp.server_info.get("name") == "pakt"

        result = mcp.compress(json.dumps(PAYLOAD))
        assert result.format == "json"
        assert result.reversible is True
        assert result.compressed.startswith("@from json")

        back = mcp.auto(result.compressed)
        assert back.action == "decompressed"
        assert json.loads(back.result) == PAYLOAD

        stats = mcp.stats()
        assert stats.total_calls >= 2
