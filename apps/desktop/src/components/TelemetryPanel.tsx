/**
 * Agent Telemetry HQ — the default tab of the tray panel.
 *
 * Live dashboard of token savings recorded by pakt's MCP server / CLI
 * in `~/.pakt/stats/`: today + 7-day savings with an inline-SVG
 * sparkline, per-agent source table, per-format chips, savings %, avg
 * latency, and lossy share. Lazy-loaded (like Settings/History) so the
 * chunk only ships when the tray panel actually renders.
 */

import type { FC } from 'react';
import { useTelemetryStats } from '../telemetry/useTelemetryStats';
import type { TelemetrySnapshot } from '../telemetry/stats-aggregate';
import { SparklineSvg } from './SparklineSvg';
import { TelemetrySourceTable, formatTokens } from './TelemetrySourceTable';
import './telemetry.css';

/** Setup snippet shown in the onboarding card. */
const SETUP_SNIPPET = 'pakt serve --stdio';

/** Onboarding card shown when `~/.pakt/stats` has no data yet. */
const TelemetryEmptyState: FC = () => (
  <section className="desktop-card desktop-card-inner telemetry-empty" aria-label="Get started">
    <p className="desktop-eyebrow">No agent telemetry yet</p>
    <h2 className="telemetry-empty-title">Point your MCP host at pakt</h2>
    <p className="desktop-copy">
      Once an agent (Claude Code, Cursor, …) routes context through pakt&rsquo;s MCP server,
      every compression call lands here automatically — no extra wiring.
    </p>
    <pre className="telemetry-snippet">
      <code>{SETUP_SNIPPET}</code>
    </pre>
    <p className="desktop-copy telemetry-empty-hint">
      e.g. <code className="telemetry-inline-code">claude mcp add pakt -- {SETUP_SNIPPET}</code>
    </p>
  </section>
);

/** One compact stat tile in the metrics strip. */
const StatTile: FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <div className="telemetry-stat">
    <p className="desktop-eyebrow">{label}</p>
    <p className="telemetry-stat-value">{value}</p>
    {hint && <p className="telemetry-stat-hint">{hint}</p>}
  </div>
);

/** Dashboard body rendered once a non-empty snapshot exists. */
const TelemetryDashboard: FC<{ snapshot: TelemetrySnapshot }> = ({ snapshot }) => {
  const lastCall = snapshot.lastCallAt
    ? new Date(snapshot.lastCallAt).toLocaleString()
    : 'never';

  return (
    <>
      <div className="telemetry-hero">
        <section className="desktop-card desktop-card-inner telemetry-hero-card">
          <p className="desktop-eyebrow">Saved today</p>
          <p className="telemetry-hero-value">
            {formatTokens(snapshot.todaySavedTokens)}
            <span className="telemetry-hero-unit">tokens</span>
          </p>
          <p className="telemetry-stat-hint">
            {snapshot.todayCalls} call{snapshot.todayCalls === 1 ? '' : 's'} today · last{' '}
            {lastCall}
          </p>
        </section>

        <section className="desktop-card desktop-card-inner telemetry-hero-card">
          <p className="desktop-eyebrow">Last 7 days</p>
          <p className="telemetry-hero-value">
            {formatTokens(snapshot.weekSavedTokens)}
            <span className="telemetry-hero-unit">tokens</span>
          </p>
          <SparklineSvg
            values={snapshot.days.map((d) => d.savedTokens)}
            label={`Tokens saved per day over the last 7 days, ending ${
              snapshot.days[snapshot.days.length - 1]?.date ?? 'today'
            }`}
          />
        </section>
      </div>

      <div className="telemetry-stat-strip" role="group" aria-label="Lifetime metrics">
        <StatTile label="Savings" value={`${snapshot.overallSavingsPercent}%`} hint="weighted" />
        <StatTile
          label="Avg latency"
          value={snapshot.avgLatencyMs === null ? '—' : `${snapshot.avgLatencyMs}ms`}
          hint={`${snapshot.latencySamples} samples`}
        />
        <StatTile
          label="Lossy share"
          value={`${snapshot.lossySharePercent}%`}
          hint={`${snapshot.lossyCalls} calls`}
        />
        <StatTile
          label="Total calls"
          value={String(snapshot.totalCalls)}
          hint={`${formatTokens(snapshot.totalSavedTokens)} saved all-time`}
        />
      </div>

      {snapshot.sources.length > 0 && (
        <section className="desktop-card desktop-card-inner">
          <div className="desktop-card-header">
            <p className="desktop-card-title">By source</p>
            {snapshot.activeSessionCount > 0 && (
              <span className="desktop-hero-chip is-strong">
                {snapshot.activeSessionCount} live session
                {snapshot.activeSessionCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <TelemetrySourceTable sources={snapshot.sources} />
        </section>
      )}

      {snapshot.formats.length > 0 && (
        <div className="desktop-chip-row telemetry-format-row" aria-label="Savings by format">
          {snapshot.formats.map((f) => (
            <span key={f.format} className="desktop-hero-chip">
              {f.format} · {f.calls} call{f.calls === 1 ? '' : 's'} ·{' '}
              {formatTokens(f.savedTokens)} saved
            </span>
          ))}
        </div>
      )}
    </>
  );
};

/**
 * Telemetry tab content. Polls `~/.pakt/stats` (via the Rust
 * `read_pakt_stats` command) every 5s while mounted and renders either
 * the dashboard or the onboarding empty state.
 */
const TelemetryPanel: FC = () => {
  const { status, snapshot } = useTelemetryStats();

  if (status === 'loading' && !snapshot) {
    return (
      <div className="telemetry-loading" role="status">
        <p className="desktop-copy">Reading agent telemetry…</p>
      </div>
    );
  }

  // Browser dev mode, missing stats dir, or zero recorded calls all land
  // on the same friendly onboarding card.
  if (status === 'unavailable' || !snapshot || !snapshot.hasData) {
    return <TelemetryEmptyState />;
  }

  return <TelemetryDashboard snapshot={snapshot} />;
};

export default TelemetryPanel;
