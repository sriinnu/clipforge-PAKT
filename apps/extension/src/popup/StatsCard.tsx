/**
 * StatsCard displays compression results: before/after token counts,
 * savings percentage, and an animated progress bar.
 *
 * Also supports a skeleton loading state shown while compression runs.
 */

import type { CacheBreakpoint, PaktFormat } from '@sriinnu/pakt';
import type React from 'react';

/** Props for StatsCard. */
interface StatsCardProps {
  /** Token counts and savings, or null when no results yet. */
  stats: {
    before: number;
    after: number;
    savings: number;
    durationMs?: number;
    cacheBreakpoint?: CacheBreakpoint;
    lossy?: boolean;
    cacheUnavailableFor?: PaktFormat;
  } | null;
  /** When true, shows a shimmer skeleton instead of real data. */
  loading: boolean;
}

/** Skeleton placeholder with shimmer animation. */
function SkeletonStats() {
  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        {/* Three skeleton bars representing Before / arrow / After / Saved */}
        <div style={skeletonItemStyle}>
          <div style={{ ...skeletonBar, width: 32, height: 8 }} />
          <div style={{ ...skeletonBar, width: 44, height: 16 }} />
        </div>
        <div style={{ ...skeletonBar, width: 14, height: 14, borderRadius: '50%' }} />
        <div style={skeletonItemStyle}>
          <div style={{ ...skeletonBar, width: 28, height: 8 }} />
          <div style={{ ...skeletonBar, width: 44, height: 16 }} />
        </div>
        <div style={skeletonItemStyle}>
          <div style={{ ...skeletonBar, width: 30, height: 8 }} />
          <div style={{ ...skeletonBar, width: 36, height: 16 }} />
        </div>
      </div>
      {/* Skeleton progress bar */}
      <div style={progressBgStyle}>
        <div style={{ ...skeletonBar, width: '60%', height: '100%', borderRadius: 2 }} />
      </div>
    </div>
  );
}

/** Renders the stats card or its skeleton loading state. */
export function StatsCard({ stats, loading }: StatsCardProps) {
  /* Show skeleton while processing */
  if (loading && !stats) return <SkeletonStats />;
  if (!stats) return null;

  const savingsPercent = Math.round(stats.savings);

  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <div style={itemStyle}>
          <span style={labelStyle}>Before</span>
          <span style={valueStyle}>{stats.before.toLocaleString()}</span>
        </div>
        <div style={{ color: 'var(--cf-text-dim)', fontSize: 16 }}>{'\u2192'}</div>
        <div style={itemStyle}>
          <span style={labelStyle}>After</span>
          <span style={valueStyle}>{stats.after.toLocaleString()}</span>
        </div>
        <div style={itemStyle}>
          <span style={labelStyle}>Saved</span>
          <span
            style={{
              ...valueStyle,
              color: savingsPercent > 0 ? 'var(--cf-success)' : 'var(--cf-text-dim)',
            }}
          >
            {savingsPercent > 0 ? `${savingsPercent}%` : '--'}
          </span>
        </div>
      </div>
      {/* Animated progress bar */}
      {savingsPercent > 0 && (
        <div style={progressBgStyle}>
          <div style={{ ...progressFillStyle, width: `${Math.min(100, savingsPercent)}%` }} />
        </div>
      )}
      {/* Optional 0.10 metadata line: latency, cache hint, lossy flag */}
      {(stats.durationMs !== undefined ||
        stats.cacheBreakpoint ||
        stats.lossy ||
        stats.cacheUnavailableFor) && (
        <div style={metaRowStyle}>
          {stats.durationMs !== undefined && (
            <span style={metaItemStyle} title="Wall-clock compress duration">
              {`${stats.durationMs}ms`}
            </span>
          )}
          {stats.cacheBreakpoint && (
            <span
              style={metaItemStyle}
              title={`Place cache marker at byte ${String(stats.cacheBreakpoint.byteOffset)} for ${stats.cacheBreakpoint.target}`}
            >
              {`cache @${String(stats.cacheBreakpoint.byteOffset)}b · ${stats.cacheBreakpoint.target} · ${
                stats.cacheBreakpoint.recommendedTTLSeconds > 0
                  ? `${String(stats.cacheBreakpoint.recommendedTTLSeconds)}s`
                  : 'auto'
              }`}
            </span>
          )}
          {stats.cacheUnavailableFor && !stats.cacheBreakpoint && (
            <span
              style={metaItemStyle}
              title={`Cache hints require a structured input. ${stats.cacheUnavailableFor} content goes through mixed-content compression which doesn't emit a prefix anchor.`}
            >
              {`cache hint: unavailable for ${stats.cacheUnavailableFor}`}
            </span>
          )}
          {stats.lossy && (
            <span style={{ ...metaItemStyle, color: 'var(--cf-warn, #ffcb6b)' }} title="Output is non-reversible (L4 semantic or PII redact)">
              lossy
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* -- Style objects -------------------------------------------------------- */

const cardStyle: React.CSSProperties = {
  padding: '10px 12px',
  backgroundColor: 'var(--cf-surface)',
  borderRadius: 'var(--cf-radius-lg)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  animation: 'fadeIn 0.25s ease',
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};
const itemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
};
const labelStyle: React.CSSProperties = {
  color: 'var(--cf-text-dim)',
  fontSize: 10,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};
const valueStyle: React.CSSProperties = { fontWeight: 700, fontSize: 15 };
const progressBgStyle: React.CSSProperties = {
  width: '100%',
  height: 4,
  backgroundColor: 'var(--cf-border)',
  borderRadius: 2,
  overflow: 'hidden',
};
const progressFillStyle: React.CSSProperties = {
  height: '100%',
  backgroundColor: 'var(--cf-success)',
  borderRadius: 2,
  transition: 'width 0.4s ease',
};
const metaRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  fontSize: 10,
  color: 'var(--cf-text-dim)',
};
const metaItemStyle: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

/** Shimmer skeleton bar — used during loading. */
const skeletonBar: React.CSSProperties = {
  backgroundColor: 'var(--cf-border)',
  borderRadius: 4,
  background:
    'linear-gradient(90deg, var(--cf-border) 25%, var(--cf-surface-hover) 50%, var(--cf-border) 75%)',
  backgroundSize: '200% 100%',
  animation: 'shimmer 1.5s infinite',
};
const skeletonItemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
};
