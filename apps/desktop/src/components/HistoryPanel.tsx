import { type FC, useMemo, useState } from 'react';
import { type HistoryEntry, useHistoryStore } from '../stores/historyStore';
import { useSettingsStore } from '../stores/settingsStore';
import FormatBadge from './FormatBadge';

interface HistoryPanelProps {
  onSelect: (entry: HistoryEntry) => void;
  onClose: () => void;
  onOpenSettings: () => void;
}

const MAX_DISPLAY = 50;

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function snippet(text: string, maxLen = 60): string {
  const oneLine = text.replace(/\n/g, ' ').trim();
  return oneLine.length > maxLen ? `${oneLine.slice(0, maxLen)}...` : oneLine;
}

const HistoryPanel: FC<HistoryPanelProps> = ({ onSelect, onClose, onOpenSettings }) => {
  const entries = useHistoryStore((s) => s.entries);
  const clearHistory = useHistoryStore((s) => s.clearHistory);
  const historyEnabled = useSettingsStore((s) => s.historyEnabled);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return entries.slice(0, MAX_DISPLAY);
    const lower = query.toLowerCase();
    return entries
      .filter(
        (e) =>
          e.input.toLowerCase().includes(lower) ||
          e.output.toLowerCase().includes(lower) ||
          e.format.toLowerCase().includes(lower),
      )
      .slice(0, MAX_DISPLAY);
  }, [entries, query]);

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-100">History</h2>
        <div className="flex items-center gap-1">
          {entries.length > 0 && (
            <button
              type="button"
              onClick={clearHistory}
              className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-500/10"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <title>Close</title>
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-gray-800 px-3 py-1.5">
        <input
          type="text"
          placeholder="Search history..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-y-auto">
        {!historyEnabled ? (
          <div className="space-y-3 p-4 text-center">
            <p className="text-xs text-gray-400">
              Local history is off. Enable it in Settings if you want ClipForge to store transformed
              clipboard content on this device.
            </p>
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded-md bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-500/30"
            >
              Open Settings
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-center text-xs text-gray-500">
            {entries.length === 0 ? 'No history yet' : 'No matches'}
          </p>
        ) : (
          filtered.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelect(entry)}
              className="flex w-full items-start gap-2 border-b border-gray-800/50 px-3 py-2 text-left hover:bg-gray-800/50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <FormatBadge format={entry.format} />
                  <span className="text-[10px] text-gray-500">{formatTime(entry.timestamp)}</span>
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-gray-400">
                  {snippet(entry.input)}
                </p>
              </div>
              <span className="shrink-0 text-[10px] text-green-500">-{entry.savedTokens}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export default HistoryPanel;
