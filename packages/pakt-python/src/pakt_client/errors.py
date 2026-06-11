"""Exception hierarchy for pakt-client.

All errors raised by this package derive from :class:`PaktError` so callers
can catch a single base class.
"""

from __future__ import annotations


class PaktError(Exception):
    """Base class for all pakt-client errors."""


class PaktNotFoundError(PaktError):
    """Raised when no usable ``pakt`` binary could be located.

    The PAKT compression engine runs in Node.js — this Python package is only
    a client. Install the engine first.
    """

    DEFAULT_MESSAGE = (
        "pakt CLI not found. The PAKT engine runs in Node.js (>= 22 required); "
        "this Python package is only a thin client.\n"
        "Install it with:\n"
        "    npm i -g @sriinnu/pakt\n"
        "or point the client at a binary explicitly:\n"
        "    PaktCli(binary='/path/to/pakt')  or  export PAKT_BIN='node /path/to/dist/cli.js'"
    )

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or self.DEFAULT_MESSAGE)


class PaktCommandError(PaktError):
    """Raised when the pakt CLI exits with a non-zero status.

    Attributes:
        returncode: The process exit code.
        stderr: Captured stderr from the failed invocation.
        argv: The full command line that was executed.
    """

    def __init__(self, argv: list[str], returncode: int, stderr: str) -> None:
        self.argv = argv
        self.returncode = returncode
        self.stderr = stderr.strip()
        super().__init__(
            f"pakt exited with code {returncode}: {self.stderr or '(no stderr)'}\n"
            f"command: {' '.join(argv)}"
        )


class PaktTimeoutError(PaktError):
    """Raised when a pakt subprocess exceeds the configured timeout."""

    def __init__(self, argv: list[str], timeout: float) -> None:
        self.argv = argv
        self.timeout = timeout
        super().__init__(f"pakt timed out after {timeout}s: {' '.join(argv)}")


class PaktParseError(PaktError):
    """Raised when CLI output does not match the expected text layout.

    The pakt CLI (0.10.x) emits human-readable ``Key: value`` text, not JSON
    (verified against ``cli-commands.ts``; the ``stats --json`` flag listed in
    ``--help`` is not implemented in 0.10.0). If the layout changes upstream,
    this error surfaces the raw output for debugging instead of silently
    returning wrong numbers.
    """

    def __init__(self, message: str, raw_output: str) -> None:
        self.raw_output = raw_output
        super().__init__(f"{message}\n--- raw output ---\n{raw_output}")


class PaktMcpError(PaktError):
    """Raised on MCP transport/protocol failures (process died, bad frame)."""


class PaktMcpToolError(PaktError):
    """Raised when an MCP tool call returns ``isError: true``."""
