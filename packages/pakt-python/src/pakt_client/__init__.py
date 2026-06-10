"""pakt-client — thin Python client for the PAKT CLI / MCP server.

The PAKT compression engine (lossless, model-free prompt compression for LLM
payloads) runs in Node.js (``@sriinnu/pakt``). This package wraps its two
language-agnostic surfaces — the CLI and the MCP stdio server — with stdlib
``subprocess``/``json`` only. It is a wrapper, **not a port**: no compression
logic is reimplemented here.

Quick start::

    from pakt_client import PaktCli

    pakt = PaktCli()  # finds pakt via PAKT_BIN, npx, or PATH
    result = pakt.compress({"items": [...]})
    restored = pakt.decompress(result.compressed, to_format="json")
"""

from .cli import PaktCli, resolve_binary
from .errors import (
    PaktCommandError,
    PaktError,
    PaktMcpError,
    PaktMcpToolError,
    PaktNotFoundError,
    PaktParseError,
    PaktTimeoutError,
)
from .mcp import PaktMcp
from .types import (
    AutoResult,
    CompressResult,
    DetectResult,
    InspectResult,
    SessionStats,
    StatsResult,
)

__version__ = "0.1.0"

__all__ = [
    "PaktCli",
    "PaktMcp",
    "resolve_binary",
    "CompressResult",
    "AutoResult",
    "InspectResult",
    "DetectResult",
    "StatsResult",
    "SessionStats",
    "PaktError",
    "PaktNotFoundError",
    "PaktCommandError",
    "PaktTimeoutError",
    "PaktParseError",
    "PaktMcpError",
    "PaktMcpToolError",
    "__version__",
]
