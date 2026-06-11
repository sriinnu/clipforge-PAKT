"""Result dataclasses for pakt-client.

Every field mirrors a real output field of the PAKT CLI (0.10.x text output)
or the PAKT MCP tool contracts (``packages/pakt-core/src/mcp/contract.ts``),
mapped camelCase -> snake_case. No invented fields.

Fields are ``Optional`` where the underlying surface only sometimes emits
them: e.g. the CLI ``compress`` command reports token counts on stderr but
not ``format``/``reversible``, while the MCP ``pakt_compress`` tool reports
all of them. Each dataclass documents which surface populates what.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Mapping, Optional


def _maybe_json(value: Any) -> Optional[dict]:
    """Parse an MCP "JSON object string" field into a dict.

    Several pakt_* contract fields (piiCounts, byFormat, latencyMs, ...) are
    documented as JSON-encoded object strings. Returns None when absent and
    the dict itself when the server ever sends a plain object.
    """
    if value is None:
        return None
    if isinstance(value, Mapping):
        return dict(value)
    if isinstance(value, str):
        return json.loads(value)
    raise TypeError(f"expected JSON object string, got {type(value).__name__}")


@dataclass(frozen=True)
class CompressResult:
    """Result of a compress operation.

    CLI source: ``pakt compress`` stdout (compressed text) + the stderr line
    ``Compressed: <N> tokens → <M> tokens (<P>% savings)``.
    MCP source: ``pakt_compress`` output (all fields populated).
    ``format``/``reversible``/``pii_*`` are MCP-only (None via CLI).
    """

    compressed: str
    original_tokens: Optional[int] = None
    compressed_tokens: Optional[int] = None
    saved_tokens: Optional[int] = None
    savings_percent: Optional[float] = None
    format: Optional[str] = None
    reversible: Optional[bool] = None
    pii_counts: Optional[dict] = None
    pii_mapping: Optional[dict] = None

    @classmethod
    def from_mcp(cls, data: Mapping[str, Any]) -> "CompressResult":
        """Build from a ``pakt_compress`` structured MCP result."""
        return cls(
            compressed=data["compressed"],
            original_tokens=data.get("originalTokens"),
            compressed_tokens=data.get("compressedTokens"),
            saved_tokens=data.get("savedTokens"),
            savings_percent=data.get("savings"),
            format=data.get("format"),
            reversible=data.get("reversible"),
            pii_counts=_maybe_json(data.get("piiCounts")),
            pii_mapping=_maybe_json(data.get("piiMapping")),
        )


@dataclass(frozen=True)
class AutoResult:
    """Result of an auto compress-or-decompress operation.

    CLI source: ``pakt auto`` stdout + stderr line (``# Saved <P>% (<N>→<M>
    tokens, −<S>)`` or ``# Decompressed PAKT input``).
    MCP source: ``pakt_auto`` output. ``was_lossy``/``dedup_hit``/
    ``below_threshold``/``pii_*`` are MCP-only.
    """

    result: str
    action: str  # 'compressed' | 'decompressed' (MCP enum AUTO_ACTION_VALUES)
    detected_format: Optional[str] = None
    original_format: Optional[str] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    saved_tokens: Optional[int] = None
    savings_percent: Optional[float] = None
    reversible: Optional[bool] = None
    was_lossy: Optional[bool] = None
    dedup_hit: Optional[bool] = None
    below_threshold: Optional[bool] = None
    pii_counts: Optional[dict] = None
    pii_mapping: Optional[dict] = None

    @classmethod
    def from_mcp(cls, data: Mapping[str, Any]) -> "AutoResult":
        """Build from a ``pakt_auto`` structured MCP result."""
        return cls(
            result=data["result"],
            action=data["action"],
            detected_format=data.get("detectedFormat"),
            original_format=data.get("originalFormat"),
            input_tokens=data.get("inputTokens"),
            output_tokens=data.get("outputTokens"),
            saved_tokens=data.get("savedTokens"),
            savings_percent=data.get("savings"),
            reversible=data.get("reversible"),
            was_lossy=data.get("wasLossy"),
            dedup_hit=data.get("dedupHit"),
            below_threshold=data.get("belowThreshold"),
            pii_counts=_maybe_json(data.get("piiCounts")),
            pii_mapping=_maybe_json(data.get("piiMapping")),
        )


@dataclass(frozen=True)
class InspectResult:
    """Result of ``pakt inspect`` / MCP ``pakt_inspect``.

    ``confidence`` is normalized to 0..1 (the MCP native unit); the CLI
    prints a percentage, which the parser divides by 100.
    """

    detected_format: str
    confidence: float
    reason: str
    input_tokens: int
    recommended_action: str  # RECOMMENDED_ACTION_VALUES enum
    estimated_output_tokens: Optional[int] = None
    estimated_savings_percent: Optional[float] = None
    estimated_saved_tokens: Optional[int] = None
    reversible: Optional[bool] = None
    original_format: Optional[str] = None
    was_lossy: Optional[bool] = None

    @classmethod
    def from_mcp(cls, data: Mapping[str, Any]) -> "InspectResult":
        """Build from a ``pakt_inspect`` structured MCP result."""
        return cls(
            detected_format=data["detectedFormat"],
            confidence=data["confidence"],
            reason=data["reason"],
            input_tokens=data["inputTokens"],
            recommended_action=data["recommendedAction"],
            estimated_output_tokens=data.get("estimatedOutputTokens"),
            estimated_savings_percent=data.get("estimatedSavings"),
            estimated_saved_tokens=data.get("estimatedSavedTokens"),
            reversible=data.get("reversible"),
            original_format=data.get("originalFormat"),
            was_lossy=data.get("wasLossy"),
        )


@dataclass(frozen=True)
class DetectResult:
    """Result of ``pakt detect`` (Format / Confidence / Reason lines)."""

    format: str
    confidence: float  # normalized 0..1 (CLI prints a percentage)
    reason: str


@dataclass(frozen=True)
class StatsResult:
    """Result of single-shot ``pakt stats <input>`` (CLI text output).

    Mirrors the lines printed by ``cmdStatsSingleShot`` in
    ``cli-commands-stats.ts``: Format / Model / Input tokens / Output tokens /
    Saved tokens / Savings / Reversible / Cost saved (input|output).
    """

    format: str
    model: str
    input_tokens: int
    output_tokens: int
    saved_tokens: int
    savings_percent: float
    reversible: bool
    cost_saved_input: Optional[float] = None
    cost_saved_output: Optional[float] = None
    currency: Optional[str] = None


@dataclass(frozen=True)
class SessionStats:
    """Result of the MCP ``pakt_stats`` tool (session-level statistics).

    JSON-object-string fields from the contract (callsByAction, byFormat,
    topFormat, estimatedCostSaved, latencyMs, lossy) are parsed into dicts.
    """

    session_duration: str
    total_calls: int
    total_input_tokens: int
    total_output_tokens: int
    total_saved_tokens: int
    overall_savings_percent: float
    calls_by_action: dict
    by_format: dict
    top_format: Optional[dict] = None
    estimated_cost_saved: Optional[dict] = None
    last_call_at: Optional[str] = None
    latency_ms: Optional[dict] = None
    lossy: Optional[dict] = None
    dedup_hits: Optional[int] = None
    dedup_entries: Optional[int] = None
    total_compounding_savings: Optional[int] = None
    rolling_dict_size: Optional[int] = None
    rolling_dict_reuses: Optional[int] = None
    rolling_dict_savings: Optional[int] = None

    @classmethod
    def from_mcp(cls, data: Mapping[str, Any]) -> "SessionStats":
        """Build from a ``pakt_stats`` structured MCP result."""
        return cls(
            session_duration=data["sessionDuration"],
            total_calls=data["totalCalls"],
            total_input_tokens=data["totalInputTokens"],
            total_output_tokens=data["totalOutputTokens"],
            total_saved_tokens=data["totalSavedTokens"],
            overall_savings_percent=data["overallSavingsPercent"],
            calls_by_action=_maybe_json(data.get("callsByAction")) or {},
            by_format=_maybe_json(data.get("byFormat")) or {},
            top_format=_maybe_json(data.get("topFormat")),
            estimated_cost_saved=_maybe_json(data.get("estimatedCostSaved")),
            last_call_at=data.get("lastCallAt"),
            latency_ms=_maybe_json(data.get("latencyMs")),
            lossy=_maybe_json(data.get("lossy")),
            dedup_hits=data.get("dedupHits"),
            dedup_entries=data.get("dedupEntries"),
            total_compounding_savings=data.get("totalCompoundingSavings"),
            rolling_dict_size=data.get("rollingDictSize"),
            rolling_dict_reuses=data.get("rollingDictReuses"),
            rolling_dict_savings=data.get("rollingDictSavings"),
        )
