"""Unit tests for binary discovery (no real pakt CLI required)."""

from __future__ import annotations

import pytest

from pakt_client import PaktNotFoundError, resolve_binary


def test_explicit_string_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    """An explicit path argument bypasses env and PATH entirely."""
    monkeypatch.setenv("PAKT_BIN", "node /elsewhere/cli.js")
    assert resolve_binary("/opt/pakt/bin/pakt") == ["/opt/pakt/bin/pakt"]


def test_explicit_argv_list_preserved() -> None:
    """An argv list (e.g. node + script) is used verbatim."""
    assert resolve_binary(["node", "/x/cli.js"]) == ["node", "/x/cli.js"]


def test_pakt_bin_env_is_shell_split(monkeypatch: pytest.MonkeyPatch) -> None:
    """PAKT_BIN supports multi-word commands like 'node dist/cli.js'."""
    monkeypatch.setenv("PAKT_BIN", "node /repo/packages/pakt-core/dist/cli.js")
    assert resolve_binary() == ["node", "/repo/packages/pakt-core/dist/cli.js"]


def test_npx_fallback_before_path(monkeypatch: pytest.MonkeyPatch) -> None:
    """With no explicit/env config, npx -y @sriinnu/pakt is preferred."""
    monkeypatch.delenv("PAKT_BIN", raising=False)
    monkeypatch.setattr(
        "pakt_client.cli.shutil.which",
        lambda name: {"npx": "/usr/bin/npx", "pakt": "/usr/bin/pakt"}.get(name),
    )
    assert resolve_binary() == ["/usr/bin/npx", "-y", "@sriinnu/pakt"]


def test_path_lookup_when_no_npx(monkeypatch: pytest.MonkeyPatch) -> None:
    """Without npx, a pakt executable on PATH is used directly."""
    monkeypatch.delenv("PAKT_BIN", raising=False)
    monkeypatch.setattr(
        "pakt_client.cli.shutil.which",
        lambda name: {"pakt": "/usr/local/bin/pakt"}.get(name),
    )
    assert resolve_binary() == ["/usr/local/bin/pakt"]


def test_not_found_raises_with_install_instructions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The error must tell the user how to install the Node engine."""
    monkeypatch.delenv("PAKT_BIN", raising=False)
    monkeypatch.setattr("pakt_client.cli.shutil.which", lambda name: None)
    with pytest.raises(PaktNotFoundError) as exc_info:
        resolve_binary()
    message = str(exc_info.value)
    assert "npm i -g @sriinnu/pakt" in message
    assert "Node.js" in message
