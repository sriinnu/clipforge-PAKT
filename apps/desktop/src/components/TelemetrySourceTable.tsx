/**
 * Per-source breakdown table for the telemetry dashboard.
 *
 * Rows are grouped by the session header's real `agent` field (the only
 * source dimension the stats schema persists — e.g. `claude-code`,
 * `cursor`); archive-derived totals appear as a synthetic `archived`
 * row. Purely presentational.
 */

import type { FC } from 'react';
import type { SourceRow } from '../telemetry/stats-aggregate';

/** Props for {@link TelemetrySourceTable}. */
export interface TelemetrySourceTableProps {
  /** Per-agent rows, already sorted by saved tokens. */
  sources: SourceRow[];
}

/** Compact number formatting: 12_400 → `12.4k`, 3_100_000 → `3.1M`. */
export function formatTokens(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

/**
 * Render the per-agent savings table. The caller hides this entirely
 * when there are no rows, so no empty state is needed here.
 */
export const TelemetrySourceTable: FC<TelemetrySourceTableProps> = ({ sources }) => (
  <table className="telemetry-table">
    <caption className="sr-only">Token savings per agent source</caption>
    <thead>
      <tr>
        <th scope="col">Source</th>
        <th scope="col" className="is-numeric">
          Calls
        </th>
        <th scope="col" className="is-numeric">
          Input
        </th>
        <th scope="col" className="is-numeric">
          Saved
        </th>
        <th scope="col" className="is-numeric">
          Savings
        </th>
      </tr>
    </thead>
    <tbody>
      {sources.map((row) => (
        <tr key={row.agent}>
          <th scope="row" className="telemetry-table-source">
            <span className="telemetry-source-name">{row.agent}</span>
            {row.active && (
              <span className="telemetry-live-dot" title="Session active" aria-label="active" />
            )}
          </th>
          <td className="is-numeric">{row.calls}</td>
          <td className="is-numeric">{formatTokens(row.inputTokens)}</td>
          <td className="is-numeric telemetry-saved">{formatTokens(row.savedTokens)}</td>
          <td className="is-numeric">{row.savingsPercent}%</td>
        </tr>
      ))}
    </tbody>
  </table>
);
