"""Parsers for pakt CLI text output (private module).

The pakt CLI (0.10.x) emits human-readable text, not JSON. Verified against
``packages/pakt-core/src/cli-commands.ts`` and empirically against the built
CLI: no subcommand emits machine-readable JSON on stdout (the ``stats --json``
flag listed in ``--help`` is not implemented in 0.10.0 and prints the same
``Key: value`` text). These parsers target that stable ``Key: value`` layout
and the fixed-format stderr stat lines.
"""

from __future__ import annotations

import re
from typing import Optional

from .errors import PaktParseError
from .types import DetectResult, InspectResult, StatsResult

# stderr from `pakt compress`:
#   "Compressed: 41 tokens → 39 tokens (5% savings)"
# The arrow is U+2192; accept ASCII "->" defensively. Savings can be negative.
_COMPRESS_STDERR_RE = re.compile(
    r"Compressed:\s*(\d+) tokens (?:→|->) (\d+) tokens \((-?\d+(?:\.\d+)?)% savings\)"
)

# stderr from `pakt auto` (after ANSI stripping):
#   "# Saved 5% (41→39 tokens, −2)"  /  "# Decompressed PAKT input"
_AUTO_SAVED_RE = re.compile(
    r"# Saved (-?\d+(?:\.\d+)?)% \((\d+)(?:→|->)(\d+) tokens"
)
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def strip_ansi(text: str) -> str:
    """Remove ANSI SGR escape sequences (the CLI colors stderr stat lines)."""
    return _ANSI_RE.sub("", text)


def parse_compress_stderr(stderr: str) -> Optional[tuple[int, int, float]]:
    """Extract (original_tokens, compressed_tokens, savings_percent).

    Returns None when the line is absent (e.g. future CLI versions); callers
    degrade to token-count-free results rather than failing the compression.
    """
    match = _COMPRESS_STDERR_RE.search(strip_ansi(stderr))
    if not match:
        return None
    return int(match.group(1)), int(match.group(2)), float(match.group(3))


def parse_auto_stderr(stderr: str) -> tuple[str, Optional[tuple[int, int, float]]]:
    """Classify a `pakt auto` run from its stderr line.

    Returns ``(action, numbers)`` where action is ``'compressed'`` or
    ``'decompressed'`` and numbers is ``(input_tokens, output_tokens,
    savings_percent)`` when the savings line was found (compress path only).
    """
    clean = strip_ansi(stderr)
    if "# Decompressed PAKT input" in clean:
        return "decompressed", None
    match = _AUTO_SAVED_RE.search(clean)
    if match:
        savings = float(match.group(1))
        return "compressed", (int(match.group(2)), int(match.group(3)), savings)
    # No recognizable line — assume compression happened, without numbers.
    return "compressed", None


def parse_key_values(stdout: str) -> dict[str, str]:
    """Parse ``Key:   value`` lines (split on the first colon) into a dict."""
    out: dict[str, str] = {}
    for line in stdout.splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        out[key.strip()] = value.strip()
    return out


def _percent(value: str) -> float:
    """Parse "99%" / "-7%" into a float percentage."""
    return float(value.rstrip("%"))


def _tokens(value: str) -> int:
    """Parse "31 tokens" / "29" into an int token count."""
    return int(value.split()[0])


def _cost(value: str) -> tuple[float, str]:
    """Parse "$-0.000005 USD" into (amount, currency)."""
    amount_str, _, currency = value.partition(" ")
    return float(amount_str.lstrip("$")), currency.strip() or "USD"


def parse_detect_output(stdout: str) -> DetectResult:
    """Parse `pakt detect` output (Format / Confidence / Reason lines)."""
    kv = parse_key_values(stdout)
    try:
        return DetectResult(
            format=kv["Format"],
            confidence=_percent(kv["Confidence"]) / 100.0,
            reason=kv["Reason"],
        )
    except KeyError as exc:
        raise PaktParseError(f"missing field {exc} in `pakt detect` output", stdout) from exc


def parse_inspect_output(stdout: str) -> InspectResult:
    """Parse `pakt inspect` output into an :class:`InspectResult`.

    Optional lines (Estimated output/savings/saved, Original format,
    Reversible, Lossy payload) map to None when absent — mirroring the
    optional fields of the pakt_inspect MCP contract.
    """
    kv = parse_key_values(stdout)
    try:
        return InspectResult(
            detected_format=kv["Format"],
            confidence=_percent(kv["Confidence"]) / 100.0,
            reason=kv["Reason"],
            input_tokens=_tokens(kv["Input tokens"]),
            recommended_action=kv["Recommended action"],
            estimated_output_tokens=(
                _tokens(kv["Estimated output"]) if "Estimated output" in kv else None
            ),
            estimated_savings_percent=(
                _percent(kv["Estimated savings"]) if "Estimated savings" in kv else None
            ),
            estimated_saved_tokens=(
                _tokens(kv["Estimated saved"]) if "Estimated saved" in kv else None
            ),
            reversible=(kv["Reversible"] == "yes") if "Reversible" in kv else None,
            original_format=kv.get("Original format"),
            was_lossy=(kv["Lossy payload"] == "yes") if "Lossy payload" in kv else None,
        )
    except (KeyError, ValueError) as exc:
        raise PaktParseError(f"unexpected `pakt inspect` output ({exc})", stdout) from exc


def parse_stats_output(stdout: str) -> StatsResult:
    """Parse single-shot `pakt stats <input>` output into a :class:`StatsResult`."""
    kv = parse_key_values(stdout)
    try:
        cost_in = kv.get("Cost saved (input)")
        cost_out = kv.get("Cost saved (output)")
        currency: Optional[str] = None
        cost_saved_input = cost_saved_output = None
        if cost_in is not None:
            cost_saved_input, currency = _cost(cost_in)
        if cost_out is not None:
            cost_saved_output, currency = _cost(cost_out)
        return StatsResult(
            format=kv["Format"],
            model=kv["Model"],
            input_tokens=_tokens(kv["Input tokens"]),
            output_tokens=_tokens(kv["Output tokens"]),
            saved_tokens=_tokens(kv["Saved tokens"]),
            savings_percent=_percent(kv["Savings"]),
            reversible=kv["Reversible"] == "true",
            cost_saved_input=cost_saved_input,
            cost_saved_output=cost_saved_output,
            currency=currency,
        )
    except (KeyError, ValueError) as exc:
        raise PaktParseError(f"unexpected `pakt stats` output ({exc})", stdout) from exc
