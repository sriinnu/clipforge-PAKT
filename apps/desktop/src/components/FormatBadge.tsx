/**
 * @module FormatBadge
 * Renders a pill-shaped badge showing the detected input format (JSON, YAML, etc.)
 * and an optional delta-encoding indicator when the compressed output uses
 * PAKT's delta compression (`@compress delta` header).
 */

import type { FC } from 'react';

interface FormatBadgeProps {
  /** Detected format key (json, yaml, csv, markdown, pakt, text). */
  format: string;
  /** Detection confidence (0–1). Shown as percentage when < 1. */
  confidence?: number;
  /** The compressed output string; checked for `@compress delta` header. */
  compressedOutput?: string;
}

const FORMAT_COLORS: Record<string, string> = {
  json: 'border-sky-300/20 bg-sky-400/10 text-sky-100',
  yaml: 'border-amber-300/20 bg-amber-400/10 text-amber-100',
  csv: 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100',
  markdown: 'border-orange-300/20 bg-orange-400/10 text-orange-100',
  pakt: 'border-indigo-300/20 bg-indigo-400/10 text-indigo-100',
  text: 'border-white/12 bg-white/8 text-slate-200',
};

const FORMAT_LABELS: Record<string, string> = {
  json: 'JSON',
  yaml: 'YAML',
  csv: 'CSV',
  markdown: 'MD',
  pakt: 'PAKT',
  text: 'Text',
};

/** Regex to detect delta-encoding header in compressed PAKT output. */
const DELTA_HEADER_RE = /@compress delta/;

const FormatBadge: FC<FormatBadgeProps> = ({ format, confidence, compressedOutput }) => {
  const colors = FORMAT_COLORS[format] ?? FORMAT_COLORS.text;
  const label = FORMAT_LABELS[format] ?? format.toUpperCase();

  /** True when the compressed output contains a delta-encoding header. */
  const hasDelta = compressedOutput ? DELTA_HEADER_RE.test(compressedOutput) : false;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] uppercase ${colors}`}
      >
        {label}
        {confidence != null && confidence < 1 && (
          <span className="text-[10px] opacity-70">{Math.round(confidence * 100)}%</span>
        )}
      </span>
      {/* Delta badge — shown when compressed output uses delta encoding */}
      {hasDelta && (
        <span className="inline-flex items-center rounded-full border border-violet-300/20 bg-violet-400/10 px-2 py-1 text-[10px] font-semibold tracking-wide uppercase text-violet-200">
          Delta
        </span>
      )}
    </span>
  );
};

export default FormatBadge;
