"""Shared pytest fixtures for pakt-client tests.

Makes the package importable without installation (src layout) and resolves
a runnable pakt CLI for integration tests. Dev path inside this monorepo:
``node packages/pakt-core/dist/cli.js`` (built by ``pnpm build`` in
packages/pakt-core); ``PAKT_BIN`` overrides everything.
"""

from __future__ import annotations

import os
import shlex
import shutil
import sys
from pathlib import Path
from typing import Optional

import pytest

# src layout: allow `import pakt_client` straight from the repo checkout.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

_REPO_ROOT = Path(__file__).resolve().parents[3]
_DIST_CLI = _REPO_ROOT / "packages" / "pakt-core" / "dist" / "cli.js"


def find_dev_pakt() -> Optional[list[str]]:
    """Resolve an argv prefix for a real pakt CLI, or None when unavailable.

    Order: PAKT_BIN env > monorepo dist build via node > `pakt` on PATH.
    (npx is intentionally skipped here — tests should not trigger network
    package downloads.)
    """
    env = os.environ.get("PAKT_BIN")
    if env:
        return shlex.split(env)
    node = shutil.which("node")
    if node and _DIST_CLI.exists():
        return [node, str(_DIST_CLI)]
    pakt = shutil.which("pakt")
    if pakt:
        return [pakt]
    return None


PAKT_AVAILABLE = find_dev_pakt() is not None


@pytest.fixture(scope="session")
def pakt_bin() -> list[str]:
    """Argv prefix for the real pakt CLI; skips the test when absent."""
    argv = find_dev_pakt()
    if argv is None:
        pytest.skip("no runnable pakt CLI (set PAKT_BIN or build packages/pakt-core)")
    return argv
