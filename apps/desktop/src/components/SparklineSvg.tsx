/**
 * Dependency-free inline-SVG sparkline for the telemetry dashboard.
 *
 * Renders a smooth-ish polyline plus a soft area fill from a plain
 * number series. Purely presentational; the parent owns sizing via the
 * `width`/`height` props and labels the chart for screen readers.
 */

import type { FC } from 'react';

/** Props for {@link SparklineSvg}. */
export interface SparklineSvgProps {
  /** Data points, oldest first. Single-point series renders a flat line. */
  values: number[];
  /** Viewbox width in px (the element scales to its container). */
  width?: number;
  /** Viewbox height in px. */
  height?: number;
  /** Accessible description of the series. */
  label: string;
}

/** Padding inside the viewbox so the stroke never clips. */
const PAD = 3;

/**
 * Map a value series onto `[x,y]` viewbox points. A flat or empty series
 * is drawn as a midline so the chart never collapses to nothing.
 */
function toPoints(values: number[], width: number, height: number): [number, number][] {
  const innerW = width - PAD * 2;
  const innerH = height - PAD * 2;
  if (values.length === 0) return [];

  const max = Math.max(...values);
  const stepX = values.length > 1 ? innerW / (values.length - 1) : 0;

  return values.map((value, i) => {
    const x = PAD + (values.length > 1 ? i * stepX : innerW / 2);
    // Max of 0 means an all-zero series — pin it to the baseline.
    const yRatio = max > 0 ? value / max : 0;
    const y = PAD + innerH - yRatio * innerH;
    return [Number(x.toFixed(2)), Number(y.toFixed(2))];
  });
}

/**
 * Inline SVG sparkline (line + area fill) with no chart dependencies.
 */
export const SparklineSvg: FC<SparklineSvgProps> = ({
  values,
  width = 160,
  height = 40,
  label,
}) => {
  const points = toPoints(values, width, height);
  const linePath = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const areaPath =
    first && last
      ? `${linePath} L${last[0]} ${height - PAD} L${first[0]} ${height - PAD} Z`
      : '';

  return (
    <svg
      className="telemetry-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      {areaPath && <path d={areaPath} className="telemetry-sparkline-area" />}
      {linePath && <path d={linePath} className="telemetry-sparkline-line" fill="none" />}
      {last && <circle cx={last[0]} cy={last[1]} r={2.4} className="telemetry-sparkline-dot" />}
    </svg>
  );
};
