"""Unit tests for CLI text parsers, fed with real captured 0.10.0 output."""

from __future__ import annotations

from pakt_client._parse import (
    parse_auto_stderr,
    parse_compress_stderr,
    parse_detect_output,
    parse_inspect_output,
    parse_stats_output,
)

# Captured verbatim from `node packages/pakt-core/dist/cli.js` (v0.10.0).
INSPECT_OUTPUT = """\
Format:               json
Confidence:           99%
Reason:               Starts with { and valid JSON parse
Input tokens:         29
Recommended action:   leave-as-is
Estimated output:     31 tokens
Estimated savings:    -7%
Estimated saved:      -2 tokens
Reversible:           yes
"""

STATS_OUTPUT = """\
Format:            json
Model:             gpt-4o
Input tokens:      29
Output tokens:     31
Saved tokens:      -2
Savings:           -7%
Reversible:        true
Cost saved (input):  $-0.000005 USD
Cost saved (output): $-0.000020 USD
"""

DETECT_OUTPUT = """\
Format:     json
Confidence: 99%
Reason:     Starts with { and valid JSON parse
"""


def test_parse_compress_stderr_real_line() -> None:
    """Parses the real arrow (U+2192) stat line, including savings."""
    parsed = parse_compress_stderr("Compressed: 41 tokens → 39 tokens (5% savings)\n")
    assert parsed == (41, 39, 5.0)


def test_parse_compress_stderr_negative_savings() -> None:
    """Savings can be negative when compression would expand the input."""
    parsed = parse_compress_stderr("Compressed: 29 tokens → 31 tokens (-7% savings)\n")
    assert parsed == (29, 31, -7.0)


def test_parse_compress_stderr_missing_returns_none() -> None:
    """Unknown stderr degrades to None instead of raising."""
    assert parse_compress_stderr("something else\n") is None


def test_parse_auto_stderr_compressed_with_ansi() -> None:
    """`pakt auto` stderr is ANSI-colored; numbers still parse."""
    line = "\x1b[90m# Saved 5% (41→39 tokens, −2)\x1b[0m\n"
    action, numbers = parse_auto_stderr(line)
    assert action == "compressed"
    assert numbers == (41, 39, 5.0)


def test_parse_auto_stderr_decompressed() -> None:
    """The decompress branch is detected from its marker line."""
    action, numbers = parse_auto_stderr("\x1b[90m# Decompressed PAKT input\x1b[0m\n")
    assert action == "decompressed"
    assert numbers is None


def test_parse_inspect_output_full() -> None:
    """All inspect fields map onto InspectResult (confidence normalized)."""
    result = parse_inspect_output(INSPECT_OUTPUT)
    assert result.detected_format == "json"
    assert abs(result.confidence - 0.99) < 1e-9
    assert result.input_tokens == 29
    assert result.recommended_action == "leave-as-is"
    assert result.estimated_output_tokens == 31
    assert result.estimated_savings_percent == -7.0
    assert result.estimated_saved_tokens == -2
    assert result.reversible is True
    assert result.was_lossy is None  # line absent for non-PAKT input


def test_parse_stats_output_full() -> None:
    """Single-shot stats lines, including the cost lines, parse 1:1."""
    result = parse_stats_output(STATS_OUTPUT)
    assert result.format == "json"
    assert result.model == "gpt-4o"
    assert result.input_tokens == 29
    assert result.output_tokens == 31
    assert result.saved_tokens == -2
    assert result.savings_percent == -7.0
    assert result.reversible is True
    assert result.cost_saved_input == -0.000005
    assert result.cost_saved_output == -0.00002
    assert result.currency == "USD"


def test_parse_detect_output() -> None:
    """detect output maps to DetectResult with normalized confidence."""
    result = parse_detect_output(DETECT_OUTPUT)
    assert result.format == "json"
    assert abs(result.confidence - 0.99) < 1e-9
    assert "valid JSON parse" in result.reason
