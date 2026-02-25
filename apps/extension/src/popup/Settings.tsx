import { useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  getSettings,
  saveSettings,
} from '../shared/storage';

// ---------------------------------------------------------------------------
// Toggle switch component
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
      type="button"
      style={{
        width: 38,
        height: 22,
        borderRadius: 11,
        backgroundColor: value ? 'var(--cf-accent)' : 'var(--cf-border)',
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background-color 0.2s ease',
        flexShrink: 0,
      }}
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          backgroundColor: '#fff',
          position: 'absolute',
          top: 3,
          left: value ? 19 : 3,
          transition: 'left 0.2s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Segmented control component
// ---------------------------------------------------------------------------
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={segmentedContainerStyle}>
      {options.map((opt) => (
        <button
          type="button"
          key={opt.value}
          style={{
            ...segmentBtnStyle,
            backgroundColor: value === opt.value ? 'var(--cf-accent)' : 'transparent',
            color: value === opt.value ? '#fff' : 'var(--cf-text-muted)',
            fontWeight: value === opt.value ? 600 : 400,
          }}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings component
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

  const compressionMode =
    settings.layerStructural && settings.layerDictionary ? 'standard' : 'structure';

  const handleCompressionChange = (mode: string) => {
    if (mode === 'standard') {
      update({ layerStructural: true, layerDictionary: true });
    } else {
      update({ layerStructural: true, layerDictionary: false });
    }
  };

  return (
    <div style={containerStyle}>
      {/* Behavior section */}
      <div style={sectionStyle}>
        <span style={sectionTitleStyle}>Behavior</span>
        <div style={settingRowStyle}>
          <div style={settingTextStyle}>
            <span style={settingLabelStyle}>Auto-compress on paste</span>
            <span style={settingDescStyle}>Automatically compress when pasting content</span>
          </div>
          <Toggle value={settings.autoCompress} onChange={(v) => update({ autoCompress: v })} />
        </div>
      </div>

      {/* Compression section */}
      <div style={sectionStyle}>
        <span style={sectionTitleStyle}>Compression Level</span>
        <SegmentedControl
          options={[
            { label: 'Standard (L1+L2)', value: 'standard' },
            { label: 'Structure only (L1)', value: 'structure' },
          ]}
          value={compressionMode}
          onChange={handleCompressionChange}
        />
        <span style={settingDescStyle}>
          {compressionMode === 'standard'
            ? 'Structural + dictionary compression for maximum token savings.'
            : 'Structural compression only. Preserves more readability.'}
        </span>
      </div>

      {/* Theme section */}
      <div style={sectionStyle}>
        <span style={sectionTitleStyle}>Theme</span>
        <SegmentedControl
          options={[
            { label: 'System', value: 'system' as const },
            { label: 'Dark', value: 'dark' as const },
            { label: 'Light', value: 'light' as const },
          ]}
          value={settings.theme}
          onChange={(v) => update({ theme: v as ExtensionSettings['theme'] })}
        />
      </div>

      {/* Info */}
      <div style={infoStyle}>
        <span>Models and providers are auto-detected from the active page context.</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--cf-text-dim)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const settingRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 12px',
  backgroundColor: 'var(--cf-surface)',
  borderRadius: 'var(--cf-radius-md)',
  gap: 12,
};

const settingTextStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: 1,
};

const settingLabelStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--cf-text)',
  fontWeight: 500,
};

const settingDescStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--cf-text-dim)',
  lineHeight: 1.4,
};

const segmentedContainerStyle: React.CSSProperties = {
  display: 'flex',
  backgroundColor: 'var(--cf-surface)',
  borderRadius: 'var(--cf-radius-md)',
  padding: 3,
  gap: 2,
};

const segmentBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: '7px 8px',
  borderRadius: 'var(--cf-radius-sm)',
  border: 'none',
  cursor: 'pointer',
  fontSize: 12,
  transition: 'all 0.2s ease',
  fontFamily: 'var(--cf-font)',
};

const infoStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--cf-text-dim)',
  padding: '10px 12px',
  backgroundColor: 'var(--cf-surface)',
  borderRadius: 'var(--cf-radius-md)',
  lineHeight: 1.5,
};
