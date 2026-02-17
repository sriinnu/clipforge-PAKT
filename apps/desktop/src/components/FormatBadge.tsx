import type { FC } from 'react';

interface FormatBadgeProps {
  format: string;
  confidence?: number;
}

const FORMAT_COLORS: Record<string, string> = {
  json: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  yaml: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  csv: 'bg-green-500/20 text-green-400 border-green-500/30',
  markdown: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  pakt: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  text: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
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
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${colors}`}
    >
      {label}
      {confidence != null && confidence < 1 && (
        <span className="text-[10px] opacity-60">
          {Math.round(confidence * 100)}%
        </span>
      )}
    </span>
  );
};

export default FormatBadge;
