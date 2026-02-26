import type { PaktFormat } from '@sriinnu/pakt';
import { VERSION } from '@sriinnu/pakt';
import type { FC } from 'react';
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

const THEMES = ['system', 'light', 'dark'] as const;

interface SettingsPanelProps {
  onClose: () => void;
}

const SettingsPanel: FC<SettingsPanelProps> = ({ onClose }) => {
  const settings = useSettingsStore();

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-100">Settings</h2>
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

      {/* Content */}
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {/* Output format */}
        <label className="block">
          <span className="text-xs font-medium text-gray-400">Default Output Format</span>
          <select
            value={settings.outputFormat}
            onChange={(e) => settings.setOutputFormat(e.target.value as PaktFormat)}
            className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-200 focus:border-indigo-500 focus:outline-none"
          >
            {OUTPUT_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        {/* Model selector */}
        <label className="block">
          <span className="text-xs font-medium text-gray-400">Token Counter Model</span>
          <select
            value={settings.model}
            onChange={(e) => settings.setModel(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-200 focus:border-indigo-500 focus:outline-none"
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        {/* Auto-compress toggle */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-400">
            Auto-compress on clipboard change
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={settings.autoCompress}
            onClick={() => settings.setAutoCompress(!settings.autoCompress)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              settings.autoCompress ? 'bg-indigo-500' : 'bg-gray-600'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                settings.autoCompress ? 'translate-x-4.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {/* Theme */}
        <fieldset className="block border-none p-0">
          <legend className="text-xs font-medium text-gray-400">Theme</legend>
          <div className="mt-1 flex gap-1">
            {THEMES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => settings.setTheme(t)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs capitalize transition-colors ${
                  settings.theme === t
                    ? 'bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/40'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </fieldset>

        {/* About */}
        <div className="border-t border-gray-800 pt-3">
          <p className="text-xs text-gray-500">
            ClipForge <span className="text-gray-400">v{VERSION}</span>
          </p>
          <p className="mt-0.5 text-[10px] text-gray-600">
            PAKT compression for your clipboard. By YugenLab.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
