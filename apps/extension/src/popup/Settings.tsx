import {
  DEFAULT_SEMANTIC_BUDGET,
  PAKT_LAYER_PROFILES,
  type PaktLayerProfileId,
  getPaktLayerProfile,
  getTokenizerFamilyInfo,
} from '@sriinnu/pakt';
import { useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  getSettings,
  saveSettings,
} from '../shared/storage';
import { FONT_PRESETS, type FontPreset } from './fonts';

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

interface SettingsProps {
  onBack: () => void;
}

/* Models shown in the Settings dropdown. Exact tokenizer families are
   `o200k_base` (gpt-4o family) and `cl100k_base` (gpt-4 / gpt-3.5).
   Claude and Llama fall back to `cl100k_base` with an approximation note. */
const TARGET_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'gpt-4o', label: 'gpt-4o (OpenAI, exact)' },
  { id: 'gpt-4o-mini', label: 'gpt-4o-mini (OpenAI, exact)' },
  { id: 'gpt-4', label: 'gpt-4 / gpt-4-turbo (OpenAI, exact)' },
  { id: 'claude-opus', label: 'claude-opus (Anthropic, approximate)' },
  { id: 'claude-sonnet', label: 'claude-sonnet (Anthropic, approximate)' },
  { id: 'claude-haiku', label: 'claude-haiku (Anthropic, approximate)' },
  { id: 'llama-3', label: 'llama-3.x (Meta, approximate)' },
];

export function Settings({ onBack: _onBack }: SettingsProps) {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  const update = (partial: Partial<ExtensionSettings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    void saveSettings(partial);
  };

  const profile = getPaktLayerProfile(settings.compressionProfileId);
  const tokenizerInfo = getTokenizerFamilyInfo(settings.targetModel);

  return (
    <div style={containerStyle}>
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

      <div style={sectionStyle}>
        <span style={sectionTitleStyle}>Compression Profile</span>
        <label style={selectLabelStyle}>
          <span style={settingLabelStyle}>Choose the active PAKT profile</span>
          <select
            value={settings.compressionProfileId}
            onChange={(event) =>
              update({ compressionProfileId: event.target.value as PaktLayerProfileId })
            }
            style={selectStyle}
          >
            {PAKT_LAYER_PROFILES.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label} ({candidate.shortLabel})
              </option>
            ))}
          </select>
        </label>
        <span style={settingDescStyle}>{profile.description}</span>
        {profile.requiresSemanticBudget ? (
          <label style={selectLabelStyle}>
            <span style={settingLabelStyle}>Semantic budget</span>
            <input
              type="number"
              min={1}
              step={1}
              value={settings.semanticBudget}
              onChange={(event) => {
                const nextValue = Number.parseInt(event.target.value, 10);
                update({
                  semanticBudget:
                    Number.isInteger(nextValue) && nextValue > 0
                      ? nextValue
                      : DEFAULT_SEMANTIC_BUDGET,
                });
              }}
              style={selectStyle}
            />
            <span style={{ ...settingDescStyle, color: 'var(--cf-warn, #ffcb6b)' }}>
              Semantic compression is lossy. Keep this for aggressive prompt packing, not exact
              formatting fidelity.
            </span>
          </label>
        ) : null}
      </div>

      <div style={sectionStyle}>
        <span style={sectionTitleStyle}>Target Model</span>
        <label style={selectLabelStyle}>
          <span style={settingLabelStyle}>
            Pick the model that will consume the compressed prompt
          </span>
          <select
            value={settings.targetModel}
            onChange={(event) => update({ targetModel: event.target.value })}
            style={selectStyle}
          >
            {TARGET_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
        <span style={settingDescStyle}>
          Tokenizer family: <strong>{tokenizerInfo.family}</strong>
          {tokenizerInfo.exact ? ' (exact)' : ' (approximate)'}
        </span>
        {!tokenizerInfo.exact ? (
          <span style={{ ...settingDescStyle, color: 'var(--cf-warn, #ffcb6b)' }}>
            {tokenizerInfo.approximationNote}
          </span>
        ) : null}
      </div>

      <div style={sectionStyle}>
        <span style={sectionTitleStyle}>Theme</span>
        <SegmentedControl
          options={[
            { label: 'System', value: 'system' as const },
            { label: 'Dark', value: 'dark' as const },
            { label: 'OLED', value: 'oled' as const },
            { label: 'Light', value: 'light' as const },
          ]}
          value={settings.theme}
          onChange={(v) => update({ theme: v as ExtensionSettings['theme'] })}
        />
      </div>

      <div style={sectionStyle}>
        <span style={sectionTitleStyle}>Font</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Array.from(Object.entries(FONT_PRESETS)).map(([key, cfg]) => {
            const isActive = settings.fontPreset === key;
            return (
              <button
                type="button"
                key={key}
                onClick={() => update({ fontPreset: key as FontPreset })}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  padding: '8px 10px',
                  borderRadius: 'var(--cf-radius-md)',
                  border: `1.5px solid ${isActive ? 'var(--cf-accent)' : 'var(--cf-border)'}`,
                  background: isActive ? 'var(--cf-accent-glow)' : 'var(--cf-surface)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'var(--cf-transition)',
                }}
              >
                <span
                  style={{
                    fontFamily: cfg.ui,
                    fontSize: 13,
                    fontWeight: 500,
                    color: isActive ? 'var(--cf-accent)' : 'var(--cf-text)',
                  }}
                >
                  {cfg.label}
                </span>
                <span
                  style={{
                    fontFamily: cfg.mono,
                    fontSize: 11,
                    color: 'var(--cf-text-muted)',
                    letterSpacing: '-0.2px',
                  }}
                >
                  {'The quick brown fox → 0.42'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={infoStyle}>
        <span>
          The popup, inline button, and context menu use the profile and target model selected
          above. Token counts and L3's merge-savings gate follow the tokenizer family resolved
          from the target model.
        </span>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  overflowY: 'auto',
  maxHeight: '460px',
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

const selectLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 'var(--cf-radius-md)',
  border: '1px solid var(--cf-border)',
  backgroundColor: 'var(--cf-surface)',
  color: 'var(--cf-text)',
  padding: '9px 10px',
  fontSize: 12,
};

const infoStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--cf-text-dim)',
  padding: '10px 12px',
  backgroundColor: 'var(--cf-surface)',
  borderRadius: 'var(--cf-radius-md)',
  lineHeight: 1.5,
};
