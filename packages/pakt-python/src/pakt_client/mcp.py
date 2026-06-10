"""Minimal stdio MCP client for the PAKT server. **Experimental.**

Spawns ``pakt serve --stdio`` and speaks newline-delimited JSON-RPC 2.0 over
its pipes — the wire format used by the official MCP stdio transport. The
handshake (``initialize`` → ``notifications/initialized`` → ``tools/call``)
was verified end-to-end against ``@sriinnu/pakt`` 0.10.0; the server returns
each tool result both as JSON text and as ``structuredContent``.

Dependency decision: this client is intentionally **stdlib-only**. The MCP
stdio subset PAKT needs (one request/response pair per call, no server-side
sampling, no notifications we must handle) is plain line-delimited JSON-RPC,
so pulling in the ``mcp`` SDK would add a dependency tree for no capability.
The ``pakt-client[mcp]`` extra installs the official SDK for users who want
to wire PAKT into a larger MCP setup themselves; this module never imports it.

Scope limits (hence "experimental"):
  * synchronous, single-threaded request/response only;
  * server-initiated requests are not answered (PAKT's server sends none);
  * stderr from the server is discarded.

Example::

    from pakt_client import PaktMcp

    with PaktMcp() as pakt:
        result = pakt.compress('{"a": 1, "b": 2}')
        print(result.compressed, result.saved_tokens)
"""

from __future__ import annotations

import json
import queue
import subprocess
import threading
from typing import Any, Mapping, Optional, Sequence, Union

from .cli import resolve_binary
from .errors import PaktMcpError, PaktMcpToolError
from .types import AutoResult, CompressResult, InspectResult, SessionStats

#: MCP protocol revision this client requests (accepted by pakt 0.10.x).
PROTOCOL_VERSION = "2025-03-26"

_CLIENT_INFO = {"name": "pakt-client-python", "version": "0.1.0"}


class PaktMcp:
    """Synchronous stdio MCP client bound to a spawned PAKT server process.

    Args:
        binary: Explicit pakt binary path or argv list; same discovery rules
            as :class:`pakt_client.cli.PaktCli` when omitted.
        agent_name: Optional ``--agent-name`` for PAKT's session stats.
        timeout: Per-request timeout in seconds.

    Raises:
        PaktNotFoundError: When no pakt binary could be located.
        PaktMcpError: When the process dies or the handshake fails.
    """

    def __init__(
        self,
        binary: Union[str, Sequence[str], None] = None,
        *,
        agent_name: Optional[str] = None,
        timeout: float = 30.0,
    ) -> None:
        argv = [*resolve_binary(binary), "serve", "--stdio"]
        if agent_name:
            argv += ["--agent-name", agent_name]
        self._timeout = timeout
        self._next_id = 0
        self._proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        # Reader thread decouples blocking pipe reads from request timeouts
        # (select() is not portable to Windows pipes).
        self._lines: "queue.Queue[Optional[str]]" = queue.Queue()
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()
        self._initialize()

    # -- transport ------------------------------------------------------------

    def _read_loop(self) -> None:
        """Pump server stdout lines into the queue; sentinel None on EOF."""
        assert self._proc.stdout is not None
        for line in self._proc.stdout:
            self._lines.put(line)
        self._lines.put(None)

    def _send(self, message: Mapping[str, Any]) -> None:
        """Write one JSON-RPC message as a single line to the server stdin."""
        if self._proc.stdin is None or self._proc.poll() is not None:
            raise PaktMcpError("pakt MCP server process is not running")
        try:
            self._proc.stdin.write(json.dumps(message) + "\n")
            self._proc.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise PaktMcpError(f"failed to write to pakt MCP server: {exc}") from exc

    def _request(self, method: str, params: Mapping[str, Any]) -> dict:
        """Send a request and block until its matching response arrives.

        Frames that are not the awaited response (server notifications or
        requests) are skipped — the PAKT server initiates none in practice.
        """
        self._next_id += 1
        request_id = self._next_id
        self._send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})

        while True:
            try:
                line = self._lines.get(timeout=self._timeout)
            except queue.Empty as exc:
                raise PaktMcpError(
                    f"timed out after {self._timeout}s waiting for response to {method!r}"
                ) from exc
            if line is None:
                code = self._proc.poll()
                raise PaktMcpError(f"pakt MCP server exited (code {code}) mid-request")
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue  # non-JSON noise on stdout; ignore
            if message.get("id") != request_id:
                continue  # notification or unrelated frame
            if "error" in message:
                err = message["error"]
                raise PaktMcpError(
                    f"JSON-RPC error {err.get('code')}: {err.get('message')}"
                )
            return message.get("result", {})

    def _initialize(self) -> None:
        """Perform the MCP handshake: initialize, then initialized notification."""
        result = self._request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": _CLIENT_INFO,
            },
        )
        self.server_info: dict = result.get("serverInfo", {})
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    # -- tool calls -----------------------------------------------------------

    def list_tools(self) -> list[dict]:
        """Return the server's tool definitions (``tools/list``)."""
        return self._request("tools/list", {}).get("tools", [])

    def call_tool(self, name: str, arguments: Mapping[str, Any]) -> dict:
        """Call a pakt_* tool and return its structured result dict.

        Prefers ``structuredContent``; falls back to parsing the JSON text
        block (the server emits both — see ``mcp/server.ts:toTextResult``).

        Raises:
            PaktMcpToolError: When the server flags the result ``isError``.
            PaktMcpError: On transport/framing failures.
        """
        result = self._request("tools/call", {"name": name, "arguments": dict(arguments)})
        if result.get("isError"):
            text = ""
            content = result.get("content") or []
            if content and isinstance(content[0], dict):
                text = str(content[0].get("text", ""))
            raise PaktMcpToolError(f"{name} failed: {text or 'Tool execution failed'}")
        structured = result.get("structuredContent")
        if isinstance(structured, dict):
            return structured
        content = result.get("content") or []
        if content and content[0].get("type") == "text":
            return json.loads(content[0]["text"])
        raise PaktMcpError(f"{name} returned no parseable content: {result!r}")

    # -- typed wrappers ---------------------------------------------------------

    def compress(self, text: str, **options: Any) -> CompressResult:
        """Call ``pakt_compress``. Options: format, semanticBudget, piiMode,
        piiKinds, piiReversible (camelCase, per the MCP contract)."""
        return CompressResult.from_mcp(self.call_tool("pakt_compress", {"text": text, **options}))

    def auto(self, text: str, **options: Any) -> AutoResult:
        """Call ``pakt_auto`` (compress raw input / decompress PAKT input)."""
        return AutoResult.from_mcp(self.call_tool("pakt_auto", {"text": text, **options}))

    def inspect(self, text: str, **options: Any) -> InspectResult:
        """Call ``pakt_inspect``. Options: model, semanticBudget."""
        return InspectResult.from_mcp(self.call_tool("pakt_inspect", {"text": text, **options}))

    def stats(self, **options: Any) -> SessionStats:
        """Call ``pakt_stats``. Options: model, scope ('session' | 'all')."""
        return SessionStats.from_mcp(self.call_tool("pakt_stats", dict(options)))

    # -- lifecycle ---------------------------------------------------------------

    def close(self) -> None:
        """Terminate the server process (idempotent)."""
        if self._proc.poll() is None:
            try:
                if self._proc.stdin:
                    self._proc.stdin.close()
                self._proc.terminate()
                self._proc.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                self._proc.kill()

    def __enter__(self) -> "PaktMcp":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        alive = self._proc.poll() is None
        return f"PaktMcp(server={self.server_info!r}, alive={alive})"
