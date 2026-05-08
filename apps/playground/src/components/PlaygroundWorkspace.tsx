/**
 * Source / Output workspace pair plus the stats grid below.
 *
 * Pure render: parent owns every textarea value, button label, button
 * `disabled` flag, and click handler. This component just lays out the
 * cards and forwards events.
 */

import type {
  CacheBreakpoint,
  CacheTarget,
  CompressibilityResult,
  PaktFormat,
} from '@sriinnu/pakt';
import { DECOMPRESS_FORMATS } from '../app-constants';
import { formatDelta, formatPercent } from '../app-helpers';

/** Tone for the right-hand stat card driven by {@link getStatsTone}. */
type StatsTone = 'idle' | 'saving' | 'expanded';

/**
 * Props for {@link PlaygroundWorkspace}. The shape mirrors the
 * relevant slice of state previously held inline in {@link App}.
 */
export interface PlaygroundWorkspaceProps {
  // Source panel
  detectedFormat: PaktFormat | string;
  input: string;
  inputTokens: number;
  compressibility: CompressibilityResult | null;
  liveCompress: boolean;
  compressButtonLabel: string;
  compressButtonDisabled: boolean;
  decompressButtonLabel: string;
  decompressButtonDisabled: boolean;
  decompressTo: PaktFormat;
  actionHint: string;

  // Output panel
  outputLabel: string;
  output: string;
  outputTokens: number;
  packedInputDetected: boolean;

  // Stats
  statsTone: StatsTone;
  actionSummary: { title: string; body: string };
  /** Cache-control hint when a provider cache target is selected. */
  cacheBreakpoint: CacheBreakpoint | null;
  /** Currently selected cache target (used to surface "no hint" reason). */
  cacheTarget: CacheTarget | undefined;
  /** True when the latest output is non-reversible (L4 / PII redact). */
  lossy: boolean;

  // Handlers
  onInputChange: (value: string) => void;
  onLiveCompressChange: (enabled: boolean) => void;
  onCompress: () => void;
  onDecompress: () => void;
  onDecompressToChange: (format: PaktFormat) => void;
  onSwap: () => void;
  onClearOutput: () => void;
  onCopyOutput: () => void;
}

/**
 * Render the side-by-side Source / Output cards and the two-card stats
 * grid below them.
 */
export function PlaygroundWorkspace(props: PlaygroundWorkspaceProps) {
  const {
    detectedFormat,
    input,
    inputTokens,
    compressibility,
    liveCompress,
    compressButtonLabel,
    compressButtonDisabled,
    decompressButtonLabel,
    decompressButtonDisabled,
    decompressTo,
    actionHint,
    outputLabel,
    output,
    outputTokens,
    packedInputDetected,
    statsTone,
    actionSummary,
    cacheBreakpoint,
    cacheTarget,
    lossy,
    onInputChange,
    onLiveCompressChange,
    onCompress,
    onDecompress,
    onDecompressToChange,
    onSwap,
    onClearOutput,
    onCopyOutput,
  } = props;

  return (
    <>
      <div className="workspace">
        <section className="card panel">
          <div className="panel-header">
            <div>
              <p id="source-panel-label" className="panel-label">
                Source input
              </p>
              <strong id="source-panel-status">{detectedFormat}</strong>
            </div>
            <span>{inputTokens.toLocaleString()} tokens</span>
          </div>
          <textarea
            id="source-input"
            aria-labelledby="source-panel-label source-panel-status"
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            spellCheck={false}
            placeholder="Paste JSON, YAML, CSV, or markdown with embedded data blocks"
          />
          {/* Compressibility indicator: score, label, and recommended profile */}
          {compressibility ? (
            <p className="compressibility-line">
              Compressibility:{' '}
              <strong className={`compressibility-${compressibility.label}`}>
                {compressibility.label}
              </strong>{' '}
              ({Math.round(compressibility.score * 100)}%) — recommended profile:{' '}
              <strong>{compressibility.profile}</strong>
            </p>
          ) : null}
          <div className="action-row">
            <label className="toggle-control" htmlFor="live-compress-toggle">
              <input
                id="live-compress-toggle"
                type="checkbox"
                checked={liveCompress}
                onChange={(event) => onLiveCompressChange(event.target.checked)}
              />
              <span>Live PAKT preview</span>
            </label>
            <button
              className="primary"
              type="button"
              onClick={onCompress}
              disabled={compressButtonDisabled}
            >
              {compressButtonLabel}
            </button>
            <button
              className="secondary"
              type="button"
              onClick={onDecompress}
              disabled={decompressButtonDisabled}
            >
              {decompressButtonLabel}
            </button>
            <label className="inline-control">
              restore as
              <select
                value={decompressTo}
                onChange={(event) => onDecompressToChange(event.target.value as PaktFormat)}
              >
                {DECOMPRESS_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="action-note">{actionHint}</p>
        </section>

        <section className="card panel accent-panel">
          <div className="panel-header">
            <div>
              <p id="output-panel-label" className="panel-label">
                Output
              </p>
              <strong id="output-panel-status">{outputLabel}</strong>
            </div>
            <span>{output ? `${outputTokens.toLocaleString()} tokens` : 'Run an action'}</span>
          </div>
          <textarea
            id="output-text"
            aria-labelledby="output-panel-label output-panel-status"
            value={output}
            readOnly
            spellCheck={false}
            placeholder={
              packedInputDetected
                ? 'PAKT detected in Input. Click Restore from PAKT to expand it.'
                : 'Output appears here'
            }
          />
          <div className="action-row compact">
            <button className="ghost" type="button" onClick={onSwap} disabled={!output}>
              Swap input/output
            </button>
            <button className="ghost" type="button" onClick={onClearOutput} disabled={!output}>
              Clear output
            </button>
            <button className="ghost" type="button" onClick={onCopyOutput} disabled={!output}>
              Copy output
            </button>
          </div>
        </section>
      </div>

      <div className="stats-grid">
        <article className="card stat-card">
          <span className="stat-label">Token delta</span>
          <strong>{output ? formatDelta(inputTokens, outputTokens) : 'Awaiting result'}</strong>
          <p>
            {output
              ? `${formatPercent(inputTokens, outputTokens)} vs input`
              : 'Compress or decompress to compare.'}
          </p>
        </article>
        <article className={`card stat-card tone-${statsTone}`}>
          <span className="stat-label">What this shows</span>
          <strong>{actionSummary.title}</strong>
          <p>{actionSummary.body}</p>
        </article>
        {cacheBreakpoint && output ? (
          <article className="card stat-card">
            <span className="stat-label">Prompt cache hint</span>
            <strong>
              {`@ byte ${cacheBreakpoint.byteOffset.toLocaleString()}`}
            </strong>
            <p>
              {`Place cache marker here for ${cacheBreakpoint.target}. `}
              {cacheBreakpoint.recommendedTTLSeconds > 0
                ? `TTL: ${String(cacheBreakpoint.recommendedTTLSeconds)}s.`
                : 'Provider auto-manages caching.'}
            </p>
          </article>
        ) : cacheTarget && output ? (
          /* Cache target set but no breakpoint came back — happens for
             markdown / text inputs that go through `compressMixed`,
             which doesn't carry a cacheBreakpoint. Tell the user why
             instead of silently dropping the hint. */
          <article className="card stat-card tone-idle">
            <span className="stat-label">Prompt cache hint</span>
            <strong>Unavailable for {detectedFormat}</strong>
            <p>
              Cache hints require a structured input (JSON, YAML, CSV).
              Markdown / text payloads route through mixed-content
              compression, which doesn't emit a prefix anchor.
            </p>
          </article>
        ) : null}
        {lossy && output ? (
          <article className="card stat-card tone-expanded">
            <span className="stat-label">Lossy output</span>
            <strong>Non-reversible</strong>
            <p>
              L4 semantic compression or PII redaction was applied. Round-trip
              will not produce the exact original payload.
            </p>
          </article>
        ) : null}
      </div>
    </>
  );
}
