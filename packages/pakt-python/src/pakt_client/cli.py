"""Subprocess client for the PAKT CLI.

The PAKT compression engine runs in Node.js (``@sriinnu/pakt``); this module
shells out to it. It is a wrapper, not a port — all compression semantics
live in the Node package.

Binary discovery order (first hit wins):

1. Explicit ``binary=`` constructor argument (path string or argv list).
2. ``PAKT_BIN`` environment variable (shell-split, so ``"node /x/cli.js"``
   works — handy for monorepo dev against ``packages/pakt-core/dist/cli.js``).
3. ``npx -y @sriinnu/pakt`` when ``npx`` is on PATH (resolves local,
   global, or cached installs; downloads on first use).
4. A ``pakt`` executable on PATH.

If none resolve, :class:`~pakt_client.errors.PaktNotFoundError` explains how
to install the engine (``npm i -g @sriinnu/pakt``, Node.js >= 22).

I/O behavior mirrors the CLI exactly (see ``packages/pakt-core/src/cli.ts``):
input is piped via stdin, results arrive on stdout, and stat lines arrive on
stderr. ``pakt stats --json`` is implemented from 0.11.0; earlier builds
(0.10.x) silently ignored the flag and printed the same ``Key: value`` text.
:class:`PaktCli` therefore parses the text layout for backward compatibility.
For natively-structured results use :class:`pakt_client.mcp.PaktMcp` instead.
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
from typing import Optional, Sequence, Union

from ._parse import (
    parse_auto_stderr,
    parse_compress_stderr,
    parse_detect_output,
    parse_inspect_output,
    parse_stats_output,
)
from .errors import PaktCommandError, PaktNotFoundError, PaktTimeoutError
from .types import AutoResult, CompressResult, DetectResult, InspectResult, StatsResult

#: Input accepted by text-taking methods: raw string, or dict/list that is
#: serialized to JSON before piping (with ``--from json`` implied).
TextOrData = Union[str, dict, list]


def resolve_binary(binary: Union[str, Sequence[str], None] = None) -> list[str]:
    """Resolve the pakt invocation argv prefix using the documented order.

    Args:
        binary: Explicit path string or argv list (e.g. ``["node", "cli.js"]``).

    Returns:
        The argv prefix to which subcommand arguments are appended.

    Raises:
        PaktNotFoundError: When no candidate could be located.
    """
    if binary is not None:
        return [binary] if isinstance(binary, str) else list(binary)

    env = os.environ.get("PAKT_BIN")
    if env:
        return shlex.split(env)

    npx = shutil.which("npx")
    if npx:
        return [npx, "-y", "@sriinnu/pakt"]

    pakt = shutil.which("pakt")
    if pakt:
        return [pakt]

    raise PaktNotFoundError()


def _coerce_text(data: TextOrData) -> tuple[str, bool]:
    """Convert input to the text piped to the CLI.

    Returns ``(text, was_json)`` — dict/list inputs are JSON-serialized and
    flagged so callers can default ``--from json``.
    """
    if isinstance(data, str):
        return data, False
    return json.dumps(data, ensure_ascii=False), True


class PaktCli:
    """Thin subprocess wrapper around the ``pakt`` CLI.

    Example::

        from pakt_client import PaktCli

        pakt = PaktCli()
        result = pakt.compress({"users": [{"id": 1, "name": "Alice"}]})
        print(result.compressed, result.saved_tokens)
        original = pakt.decompress(result.compressed, to_format="json")

    Args:
        binary: Explicit pakt binary path or argv list. Overrides discovery.
        timeout: Default per-invocation timeout in seconds.
    """

    def __init__(
        self,
        binary: Union[str, Sequence[str], None] = None,
        *,
        timeout: float = 60.0,
    ) -> None:
        self._argv_prefix = resolve_binary(binary)
        self._timeout = timeout

    # -- low-level ----------------------------------------------------------

    def _run(
        self,
        args: Sequence[str],
        input_text: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> subprocess.CompletedProcess[str]:
        """Run ``pakt <args>`` with input piped to stdin; raise on failure."""
        argv = [*self._argv_prefix, *args]
        effective_timeout = self._timeout if timeout is None else timeout
        try:
            proc = subprocess.run(
                argv,
                input=input_text,
                capture_output=True,
                text=True,
                timeout=effective_timeout,
            )
        except FileNotFoundError as exc:
            raise PaktNotFoundError(
                f"failed to execute {argv[0]!r}: {exc}.\n{PaktNotFoundError.DEFAULT_MESSAGE}"
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise PaktTimeoutError(argv, effective_timeout) from exc

        if proc.returncode != 0:
            raise PaktCommandError(argv, proc.returncode, proc.stderr)
        return proc

    @staticmethod
    def _build_compress_args(
        command: str,
        *,
        from_format: Optional[str] = None,
        to_format: Optional[str] = None,
        layers: Optional[Sequence[int]] = None,
        semantic_budget: Optional[int] = None,
        pii_mode: Optional[str] = None,
        pii_kinds: Optional[Sequence[str]] = None,
        pii_reversible: bool = False,
        model: Optional[str] = None,
    ) -> list[str]:
        """Map keyword options to the CLI flags defined in ``cli.ts``."""
        args = [command]
        if from_format:
            args += ["--from", from_format]
        if to_format:
            args += ["--to", to_format]
        if layers:
            args += ["--layers", ",".join(str(layer) for layer in layers)]
        if semantic_budget is not None:
            args += ["--semantic-budget", str(semantic_budget)]
        if pii_mode:
            args += ["--pii-mode", pii_mode]
        if pii_kinds:
            args += ["--pii-kinds", ",".join(pii_kinds)]
        if pii_reversible:
            args.append("--pii-reversible")
        if model:
            args += ["--model", model]
        return args

    @staticmethod
    def _strip_trailing_newline(stdout: str) -> str:
        """Drop the single trailing newline the CLI appends to payload output."""
        return stdout[:-1] if stdout.endswith("\n") else stdout

    # -- commands ------------------------------------------------------------

    def compress(
        self,
        data: TextOrData,
        *,
        from_format: Optional[str] = None,
        layers: Optional[Sequence[int]] = None,
        semantic_budget: Optional[int] = None,
        pii_mode: Optional[str] = None,
        pii_kinds: Optional[Sequence[str]] = None,
        pii_reversible: bool = False,
        timeout: Optional[float] = None,
    ) -> CompressResult:
        """Compress text or a dict/list into PAKT format (``pakt compress``).

        Args:
            data: Raw text, or a dict/list (JSON-serialized; implies
                ``from_format='json'`` unless overridden).
            from_format: Force input format (json|yaml|csv|md|text).
            layers: Compression layers to enable, e.g. ``[1, 2]``.
            semantic_budget: Opt-in lossy L4 budget (positive token count).
            pii_mode: 'off' | 'flag' | 'redact'.
            pii_kinds: Restrict PII scan kinds (e.g. ``['email', 'jwt']``).
            pii_reversible: Emit placeholder mapping with redact mode.
            timeout: Per-call timeout override in seconds.

        Returns:
            CompressResult with token counts parsed from the CLI stderr stat
            line when present (``format``/``reversible`` stay None — they are
            only reported by the MCP surface).
        """
        text, was_json = _coerce_text(data)
        args = self._build_compress_args(
            "compress",
            from_format=from_format or ("json" if was_json else None),
            layers=layers,
            semantic_budget=semantic_budget,
            pii_mode=pii_mode,
            pii_kinds=pii_kinds,
            pii_reversible=pii_reversible,
        )
        proc = self._run(args, input_text=text, timeout=timeout)
        compressed = self._strip_trailing_newline(proc.stdout)
        numbers = parse_compress_stderr(proc.stderr)
        if numbers is None:
            return CompressResult(compressed=compressed)
        original, after, savings = numbers
        return CompressResult(
            compressed=compressed,
            original_tokens=original,
            compressed_tokens=after,
            saved_tokens=original - after,
            savings_percent=savings,
        )

    def decompress(
        self,
        text: str,
        *,
        to_format: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> str:
        """Decompress PAKT text back to its original form (``pakt decompress``).

        Args:
            text: A PAKT-formatted payload.
            to_format: Output format override (json|yaml|csv|md|text).
            timeout: Per-call timeout override in seconds.

        Returns:
            The decompressed text (the CLI reports no metadata here).
        """
        args = ["decompress"] + (["--to", to_format] if to_format else [])
        proc = self._run(args, input_text=text, timeout=timeout)
        return self._strip_trailing_newline(proc.stdout)

    def auto(
        self,
        data: TextOrData,
        *,
        from_format: Optional[str] = None,
        to_format: Optional[str] = None,
        layers: Optional[Sequence[int]] = None,
        semantic_budget: Optional[int] = None,
        pii_mode: Optional[str] = None,
        pii_kinds: Optional[Sequence[str]] = None,
        pii_reversible: bool = False,
        timeout: Optional[float] = None,
    ) -> AutoResult:
        """Auto-detect and compress or decompress (``pakt auto``).

        PAKT input is decompressed; anything else is compressed. The action
        and token numbers are parsed from the CLI stderr line.
        """
        text, was_json = _coerce_text(data)
        args = self._build_compress_args(
            "auto",
            from_format=from_format or ("json" if was_json else None),
            to_format=to_format,
            layers=layers,
            semantic_budget=semantic_budget,
            pii_mode=pii_mode,
            pii_kinds=pii_kinds,
            pii_reversible=pii_reversible,
        )
        proc = self._run(args, input_text=text, timeout=timeout)
        output = self._strip_trailing_newline(proc.stdout)
        action, numbers = parse_auto_stderr(proc.stderr)
        if numbers is None:
            return AutoResult(result=output, action=action)
        input_tokens, output_tokens, savings = numbers
        return AutoResult(
            result=output,
            action=action,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            saved_tokens=input_tokens - output_tokens,
            savings_percent=savings,
        )

    def detect(self, data: TextOrData, *, timeout: Optional[float] = None) -> DetectResult:
        """Detect the input format (``pakt detect``)."""
        text, _ = _coerce_text(data)
        proc = self._run(["detect"], input_text=text, timeout=timeout)
        return parse_detect_output(proc.stdout)

    def inspect(
        self,
        data: TextOrData,
        *,
        model: Optional[str] = None,
        semantic_budget: Optional[int] = None,
        timeout: Optional[float] = None,
    ) -> InspectResult:
        """Inspect a payload before compressing (``pakt inspect``).

        Note: the 0.10.x CLI prints ``Key: value`` text (no ``--json``
        support); the structured result is parsed from that layout.
        """
        text, _ = _coerce_text(data)
        args = self._build_compress_args(
            "inspect", model=model, semantic_budget=semantic_budget
        )
        proc = self._run(args, input_text=text, timeout=timeout)
        return parse_inspect_output(proc.stdout)

    def stats(
        self,
        data: TextOrData,
        *,
        model: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> StatsResult:
        """Single-shot compression stats for a payload (``pakt stats <input>``).

        Only the single-shot mode is reachable from a subprocess: the CLI's
        persistent mode requires a TTY stdin. The ``--json`` flag is fully
        implemented from **0.11.0**; this method still parses the ``Key:
        value`` text path for backward compatibility with 0.10.x installs —
        a future version may prefer the JSON output. For session-level stats
        use :meth:`pakt_client.mcp.PaktMcp.stats`.
        """
        text, _ = _coerce_text(data)
        args = self._build_compress_args("stats", model=model)
        proc = self._run(args, input_text=text, timeout=timeout)
        return parse_stats_output(proc.stdout)

    def tokens(
        self,
        data: TextOrData,
        *,
        model: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> int:
        """Count tokens in a payload (``pakt tokens``)."""
        text, _ = _coerce_text(data)
        args = self._build_compress_args("tokens", model=model)
        proc = self._run(args, input_text=text, timeout=timeout)
        return int(proc.stdout.strip())

    def version(self, *, timeout: Optional[float] = None) -> str:
        """Return the pakt CLI version (``pakt --version``)."""
        proc = self._run(["--version"], timeout=timeout)
        return proc.stdout.strip()

    # -- introspection --------------------------------------------------------

    @property
    def argv_prefix(self) -> list[str]:
        """The resolved invocation prefix (useful for debugging discovery)."""
        return list(self._argv_prefix)

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        return f"PaktCli(argv_prefix={self._argv_prefix!r})"
