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
    <div className="desktop-overlay">
      <div className="desktop-toolbar desktop-overlay-toolbar">
        <div className="desktop-toolbar-left">
          <div className="desktop-brand-copy desktop-overlay-copy">
            <p className="desktop-eyebrow">History</p>
            <h2 className="desktop-brand-title">Recent transforms</h2>
            <p className="desktop-copy">Jump back into a recent payload or clear the local list.</p>
          </div>
        </div>
        <div className="desktop-toolbar-actions">
          {entries.length > 0 && (
            <button type="button" onClick={clearHistory} className="desktop-inline-action">
              Clear
            </button>
          )}
          <button type="button" onClick={onClose} className="desktop-icon-button">
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <title>Close</title>
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="desktop-overlay-content">
        <div className="desktop-overlay-summary">
          <span className="desktop-hero-chip">{entries.length} saved items</span>
          <span className="desktop-hero-chip">
            {historyEnabled ? 'Local history on' : 'Local history off'}
          </span>
        </div>

        <input
          type="text"
          placeholder="Search history..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="desktop-search"
        />

        {!historyEnabled ? (
          <div className="desktop-empty">
            <p>
              Local history is off. Enable it in Settings if you want ClipForge to store transformed
              clipboard content on this device.
            </p>
            <button type="button" onClick={onOpenSettings} className="desktop-soft-button">
              Open Settings
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="desktop-empty">{entries.length === 0 ? 'No history yet' : 'No matches'}</p>
        ) : (
          <div className="desktop-list">
            {filtered.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelect(entry)}
                className="desktop-list-item"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <FormatBadge format={entry.format} />
                    <span className="desktop-card-meta">{formatTime(entry.timestamp)}</span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-slate-300/80">
                    {snippet(entry.input)}
                  </p>
                </div>
                <span className="desktop-savings-pill">-{entry.savedTokens}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryPanel;
