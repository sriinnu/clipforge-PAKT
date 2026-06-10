"""Unit tests for argument building and subprocess invocation (mocked)."""

from __future__ import annotations

import subprocess
from typing import Any

import pytest

from pakt_client import PaktCli, PaktCommandError, PaktTimeoutError


def make_cli() -> PaktCli:
    """PaktCli with a fixed fake binary so discovery never runs."""
    return PaktCli(binary=["/fake/pakt"])


class RunRecorder:
    """Capture subprocess.run calls and return a canned CompletedProcess."""

    def __init__(self, stdout: str = "", stderr: str = "", returncode: int = 0) -> None:
        self.calls: list[dict[str, Any]] = []
        self._stdout = stdout
        self._stderr = stderr
        self._returncode = returncode

    def __call__(self, argv: list[str], **kwargs: Any) -> subprocess.CompletedProcess:
        self.calls.append({"argv": argv, **kwargs})
        return subprocess.CompletedProcess(
            argv, self._returncode, stdout=self._stdout, stderr=self._stderr
        )


def test_compress_builds_full_flag_set(monkeypatch: pytest.MonkeyPatch) -> None:
    """All keyword options map 1:1 to the CLI flags defined in cli.ts."""
    recorder = RunRecorder(
        stdout="@from json\n\nx: 1\n",
        stderr="Compressed: 41 tokens → 39 tokens (5% savings)\n",
    )
    monkeypatch.setattr("pakt_client.cli.subprocess.run", recorder)

    result = make_cli().compress(
        "x: 1",
        from_format="yaml",
        layers=[1, 2],
        semantic_budget=120,
        pii_mode="redact",
        pii_kinds=["email", "jwt"],
        pii_reversible=True,
    )

    call = recorder.calls[0]
    assert call["argv"] == [
        "/fake/pakt",
        "compress",
        "--from", "yaml",
        "--layers", "1,2",
        "--semantic-budget", "120",
        "--pii-mode", "redact",
        "--pii-kinds", "email,jwt",
        "--pii-reversible",
    ]
    assert call["input"] == "x: 1"  # piped via stdin, no temp files
    # stderr stat line parsed into token counts
    assert result.original_tokens == 41
    assert result.compressed_tokens == 39
    assert result.saved_tokens == 2
    assert result.savings_percent == 5.0
    # CLI appends one trailing newline; the wrapper strips exactly one
    assert result.compressed.endswith("x: 1")


def test_dict_input_serializes_to_json_and_sets_from(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """dict/list payloads are JSON-dumped and imply --from json."""
    recorder = RunRecorder(stdout="out\n", stderr="")
    monkeypatch.setattr("pakt_client.cli.subprocess.run", recorder)

    make_cli().compress({"a": 1})

    call = recorder.calls[0]
    assert call["argv"][:3] == ["/fake/pakt", "compress", "--from"]
    assert call["argv"][3] == "json"
    assert call["input"] == '{"a": 1}'


def test_decompress_passes_to_format(monkeypatch: pytest.MonkeyPatch) -> None:
    """decompress maps to `pakt decompress --to <fmt>` and returns stdout."""
    recorder = RunRecorder(stdout='{"a":1}\n', stderr="")
    monkeypatch.setattr("pakt_client.cli.subprocess.run", recorder)

    text = make_cli().decompress("@from json\n\na: 1\n", to_format="json")

    assert recorder.calls[0]["argv"] == ["/fake/pakt", "decompress", "--to", "json"]
    assert text == '{"a":1}'


def test_nonzero_exit_raises_command_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Non-zero CLI exit surfaces stderr in a PaktCommandError."""
    recorder = RunRecorder(stdout="", stderr="Error: bad input\n", returncode=1)
    monkeypatch.setattr("pakt_client.cli.subprocess.run", recorder)

    with pytest.raises(PaktCommandError) as exc_info:
        make_cli().decompress("not pakt")
    assert exc_info.value.returncode == 1
    assert "bad input" in str(exc_info.value)


def test_timeout_raises_pakt_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    """subprocess.TimeoutExpired is translated to PaktTimeoutError."""

    def boom(argv: list[str], **kwargs: Any) -> None:
        raise subprocess.TimeoutExpired(argv, kwargs.get("timeout", 0))

    monkeypatch.setattr("pakt_client.cli.subprocess.run", boom)
    with pytest.raises(PaktTimeoutError):
        make_cli().compress("data", timeout=0.01)


def test_tokens_returns_int(monkeypatch: pytest.MonkeyPatch) -> None:
    """tokens() parses the bare count printed by `pakt tokens`."""
    recorder = RunRecorder(stdout="5\n", stderr="")
    monkeypatch.setattr("pakt_client.cli.subprocess.run", recorder)

    assert make_cli().tokens('{"a":1}', model="claude-sonnet") == 5
    assert recorder.calls[0]["argv"] == [
        "/fake/pakt", "tokens", "--model", "claude-sonnet",
    ]
