import type { PaktFormat } from '@sriinnu/pakt';
import { VERSION } from '@sriinnu/pakt';
import type { FC } from 'react';
import { useHistoryStore } from '../stores/historyStore';
import { useSettingsStore } from '../stores/settingsStore';

const OUTPUT_FORMATS: { value: PaktFormat; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'csv', label: 'CSV' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: 'Text' },
];

const MODELS = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'claude-sonnet', label: 'Claude Sonnet' },
  { value: 'claude-opus', label: 'Claude Opus' },
  { value: 'claude-haiku', label: 'Claude Haiku' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
];

interface SettingsPanelProps {
  onClose: () => void;
}

const SettingsPanel: FC<SettingsPanelProps> = ({ onClose }) => {
  const settings = useSettingsStore();
  const clearHistory = useHistoryStore((s) => s.clearHistory);

  const handleHistoryToggle = () => {
    const nextValue = !settings.historyEnabled;
    settings.setHistoryEnabled(nextValue);
    if (!nextValue) {
      clearHistory();
    }
  };

  return (
    <div className="desktop-overlay">
      <div className="desktop-toolbar desktop-overlay-toolbar">
        <div className="desktop-toolbar-left">
          <div className="desktop-brand-copy desktop-overlay-copy">
            <p className="desktop-eyebrow">Settings</p>
            <h2 className="desktop-brand-title">Menu bar preferences</h2>
            <p className="desktop-copy">
              Tune output defaults, clipboard watch, and local history.
            </p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="desktop-icon-button">
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <title>Close</title>
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>

      <div className="desktop-overlay-content">
        <div className="desktop-overlay-summary">
          <span className="desktop-hero-chip">Output {settings.outputFormat.toUpperCase()}</span>
          <span className="desktop-hero-chip">{settings.model}</span>
          <span className="desktop-hero-chip">
            {settings.autoCompress ? 'Watch on' : 'Watch off'}
          </span>
          {settings.layers.semantic ? (
            <span className="desktop-hero-chip">Semantic {settings.semanticBudget}</span>
          ) : null}
        </div>

        <label className="block desktop-card desktop-card-inner">
          <span className="desktop-section-title">Default Output Format</span>
          <select
            value={settings.outputFormat}
            onChange={(e) => settings.setOutputFormat(e.target.value as PaktFormat)}
            className="desktop-select"
          >
            {OUTPUT_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block desktop-card desktop-card-inner">
          <span className="desktop-section-title">Token Counter Model</span>
          <select
            value={settings.model}
            onChange={(e) => settings.setModel(e.target.value)}
            className="desktop-select"
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <div className="desktop-card desktop-card-inner">
          <div className="desktop-card-header">
            <div>
              <p className="desktop-section-title">Auto clipboard</p>
              <p className="desktop-copy">
                Desktop-only. New clipboard text is loaded into the panel and compressed
                automatically without overwriting the clipboard.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoCompress}
              onClick={() => settings.setAutoCompress(!settings.autoCompress)}
              className={`desktop-toggle ${settings.autoCompress ? 'is-on' : ''}`}
            >
              <span className="desktop-toggle-thumb" />
            </button>
          </div>
        </div>

        <div className="desktop-card desktop-card-inner">
          <div className="desktop-card-header">
            <div>
              <p className="desktop-section-title">Local history</p>
              <p className="desktop-copy">
                Off by default. When disabled, saved entries are cleared from local storage.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.historyEnabled}
              onClick={handleHistoryToggle}
              className={`desktop-toggle ${settings.historyEnabled ? 'is-on' : ''}`}
            >
              <span className="desktop-toggle-thumb" />
            </button>
          </div>
        </div>

        <div className="desktop-card desktop-card-inner">
          <p className="desktop-section-title">Shell theme</p>
          <p className="desktop-copy" style={{ marginTop: '8px' }}>
            The current release ships the menu bar shell in its validated dark-glass theme. Theme
            switching is not exposed here until the shell itself can apply it reliably.
          </p>
        </div>

        <div className="desktop-card desktop-card-inner">
          <p className="desktop-section-title">Semantic profile</p>
          <p className="desktop-copy" style={{ marginTop: '8px' }}>
            L4 now works when you enable the Semantic layer and give it a positive budget in the
            layer controls. Keep it for aggressive packing, not exact round-trip guarantees.
          </p>
        </div>

        <div className="desktop-card desktop-card-inner">
          <p className="desktop-section-title">About</p>
          <p className="desktop-brand-title">
            ClipForge <span className="desktop-card-meta">v{VERSION}</span>
          </p>
          <p className="desktop-copy" style={{ marginTop: '8px' }}>
            macOS menu bar build validated in this repository. Windows and Linux tray targets exist
            in source, but are not part of the current release validation pass.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
