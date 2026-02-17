import { useState, useEffect } from 'react';
import {
  getSettings,
  saveSettings,
  type ExtensionSettings,
  DEFAULT_SETTINGS,
} from '../shared/storage';

// ---------------------------------------------------------------------------
// Brand colors (matching Popup)
// ---------------------------------------------------------------------------
const C = {
  primary: '#7c3aed',
  bg: '#1e1b2e',
  surface: '#2d2640',
  text: '#e2e0ea',
  textMuted: '#9e99b0',
  border: '#443d5a',
} as const;

const styles = {
  container: {
    padding: 16,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 14,
  } as React.CSSProperties,
  section: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: C.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  } as React.CSSProperties,
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    backgroundColor: C.surface,
    borderRadius: 6,
  } as React.CSSProperties,
  label: {
    fontSize: 13,
    color: C.text,
  } as React.CSSProperties,
  toggle: (on: boolean) =>
    ({
      width: 36,
      height: 20,
      borderRadius: 10,
      backgroundColor: on ? C.primary : C.border,
      border: 'none',
      cursor: 'pointer',
      position: 'relative' as const,
      transition: 'background-color 0.2s',
    }) as React.CSSProperties,
  toggleDot: (on: boolean) =>
    ({
      width: 14,
      height: 14,
      borderRadius: '50%',
      backgroundColor: '#fff',
      position: 'absolute' as const,
      top: 3,
      left: on ? 19 : 3,
      transition: 'left 0.2s',
    }) as React.CSSProperties,
  select: {
    padding: '8px 12px',
    backgroundColor: C.surface,
    color: C.text,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    fontSize: 12,
    outline: 'none',
    width: '100%',
  } as React.CSSProperties,
  siteList: {
    padding: '8px 12px',
    backgroundColor: C.surface,
    borderRadius: 6,
    fontSize: 12,
    color: C.textMuted,
    lineHeight: 1.6,
  } as React.CSSProperties,
} as const;

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------
function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      style={styles.toggle(value)}
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
    >
      <div style={styles.toggleDot(value)} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface SettingsProps {
  onBack: () => void;
}

export function Settings({ onBack: _onBack }: SettingsProps) {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  const update = (partial: Partial<ExtensionSettings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    saveSettings(partial);
  };

  return (
    <div style={styles.container}>
      {/* Compression layers */}
      <div style={styles.section}>
        <span style={styles.sectionTitle}>Compression Layers</span>
        <div style={styles.toggleRow}>
          <span style={styles.label}>L1 - Structural</span>
          <Toggle
            value={settings.layerStructural}
            onChange={(v) => update({ layerStructural: v })}
          />
        </div>
        <div style={styles.toggleRow}>
          <span style={styles.label}>L2 - Dictionary</span>
          <Toggle
            value={settings.layerDictionary}
            onChange={(v) => update({ layerDictionary: v })}
          />
        </div>
      </div>

      {/* Auto-compress */}
      <div style={styles.section}>
        <span style={styles.sectionTitle}>Behavior</span>
        <div style={styles.toggleRow}>
          <span style={styles.label}>Auto-compress on paste</span>
          <Toggle
            value={settings.autoCompress}
            onChange={(v) => update({ autoCompress: v })}
          />
        </div>
      </div>

      {/* Target model */}
      <div style={styles.section}>
        <span style={styles.sectionTitle}>Target Model</span>
        <select
          style={styles.select}
          value={settings.targetModel}
          onChange={(e) => update({ targetModel: e.target.value })}
        >
          <option value="gpt-4o">GPT-4o</option>
          <option value="gpt-4o-mini">GPT-4o Mini</option>
          <option value="claude-sonnet">Claude Sonnet</option>
          <option value="claude-opus">Claude Opus</option>
          <option value="claude-haiku">Claude Haiku</option>
        </select>
      </div>

      {/* Active sites */}
      <div style={styles.section}>
        <span style={styles.sectionTitle}>Active Sites</span>
        <div style={styles.siteList}>
          {settings.enabledSites.map((site) => (
            <div key={site}>{site}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
