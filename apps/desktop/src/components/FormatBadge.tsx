import type { FC } from 'react';

interface FormatBadgeProps {
  format: string;
  confidence?: number;
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

const FormatBadge: FC<FormatBadgeProps> = ({ format, confidence }) => {
  const colors = FORMAT_COLORS[format] ?? FORMAT_COLORS.text;
  const label = FORMAT_LABELS[format] ?? format.toUpperCase();

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] uppercase ${colors}`}
    >
      {label}
      {confidence != null && confidence < 1 && (
        <span className="text-[10px] opacity-70">{Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
};

export default FormatBadge;
