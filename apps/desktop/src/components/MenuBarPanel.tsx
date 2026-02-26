import type { PaktFormat } from '@sriinnu/pakt';
import { type FC, useCallback, useEffect, useState } from 'react';
import { useClipboard } from '../hooks/useClipboard';
import { useCompactor } from '../hooks/useCompactor';
import { useHistoryStore } from '../stores/historyStore';
import type { HistoryEntry } from '../stores/historyStore';
import { useSettingsStore } from '../stores/settingsStore';
import FormatBadge from './FormatBadge';
import HistoryPanel from './HistoryPanel';
import LayerControls from './LayerControls';
import SettingsPanel from './SettingsPanel';
import TokenBar from './TokenBar';

const OUTPUT_FORMATS: { value: PaktFormat; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'csv', label: 'CSV' },
  { value: 'markdown', label: 'MD' },
  { value: 'text', label: 'Text' },
];

type Panel = 'main' | 'settings' | 'history';

const MenuBarPanel: FC = () => {
  const compactor = useCompactor();
  const clipboard = useClipboard();
  const layers = useSettingsStore((s) => s.layers);
  const outputFormat = useSettingsStore((s) => s.outputFormat);
  const addEntry = useHistoryStore((s) => s.addEntry);

  const [panel, setPanel] = useState<Panel>('main');
  const [selectedFormat, setSelectedFormat] = useState<PaktFormat>(outputFormat);
  const [copied, setCopied] = useState(false);

  // Load clipboard on mount — sync effect below handles pushing content to compactor
  useEffect(() => {
    clipboard.readClipboard();
  }, [clipboard.readClipboard]);

  // Sync clipboard content to input when it changes
  useEffect(() => {
    if (clipboard.content) {
      compactor.setInput(clipboard.content);
    }
  }, [clipboard.content, compactor.setInput]);

  const handleCompress = useCallback(() => {
    compactor.compress({ layers, fromFormat: undefined });
  }, [compactor, layers]);

  const handleDecompress = useCallback(() => {
    compactor.decompress(selectedFormat);
  }, [compactor, selectedFormat]);

  // Save to history on successful output
  useEffect(() => {
    if (compactor.output && compactor.originalTokens > 0) {
      addEntry({
        input: compactor.input,
        output: compactor.output,
        format: compactor.format,
        savedTokens: compactor.originalTokens - compactor.compressedTokens,
      });
    }
  }, [
    compactor.output,
    compactor.input,
    compactor.format,
    compactor.originalTokens,
    compactor.compressedTokens,
    addEntry,
  ]);

  const handleCopy = useCallback(async () => {
    if (!compactor.output) return;
    await clipboard.writeClipboard(compactor.output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [compactor.output, clipboard]);

  const handleHistorySelect = useCallback(
    (entry: HistoryEntry) => {
      compactor.setInput(entry.input);
      setPanel('main');
    },
    [compactor],
  );

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-gray-900 text-gray-100">
      {/* Overlays */}
      {panel === 'settings' && <SettingsPanel onClose={() => setPanel('main')} />}
      {panel === 'history' && (
        <HistoryPanel onSelect={handleHistorySelect} onClose={() => setPanel('main')} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-bold tracking-tight text-indigo-400">ClipForge</h1>
          <FormatBadge format={compactor.format} />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPanel('history')}
            title="History"
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <title>History</title>
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setPanel('settings')}
            title="Settings"
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <title>Settings</title>
              <path
                fillRule="evenodd"
                d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.2.966.46 1.397.772l1.4-.56a1 1 0 011.12.32l.68 1.178a1 1 0 01-.14 1.124l-1.107.913c.048.514.048 1.033 0 1.547l1.107.913a1 1 0 01.14 1.124l-.68 1.178a1 1 0 01-1.12.32l-1.4-.56c-.43.312-.9.572-1.397.772l-.295 1.473a1 1 0 01-.98.804H9.32a1 1 0 01-.98-.804l-.295-1.473a5.957 5.957 0 01-1.397-.772l-1.4.56a1 1 0 01-1.12-.32l-.68-1.178a1 1 0 01.14-1.124l1.107-.913a5.93 5.93 0 010-1.547L3.587 7.87a1 1 0 01-.14-1.124l.68-1.178a1 1 0 011.12-.32l1.4.56c.43-.312.9-.572 1.397-.772l.295-1.473zM10 13a3 3 0 100-6 3 3 0 000 6z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {/* Input textarea */}
        <div className="relative">
          <textarea
            value={compactor.input}
            onChange={(e) => compactor.setInput(e.target.value)}
            placeholder="Paste or type content here..."
            rows={6}
            className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-2 font-mono text-xs text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => clipboard.readClipboard()}
            title="Read from clipboard"
            className="absolute right-1.5 top-1.5 rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <title>Read from clipboard</title>
              <path d="M13.887 3.182c.396.037.79.08 1.183.128C16.194 3.45 17 4.414 17 5.517V16.75A2.25 2.25 0 0114.75 19h-9.5A2.25 2.25 0 013 16.75V5.517c0-1.103.806-2.068 1.93-2.207.393-.048.787-.09 1.183-.128A3.001 3.001 0 019 1h2c1.373 0 2.531.923 2.887 2.182zM7.5 4A1.5 1.5 0 019 2.5h2A1.5 1.5 0 0112.5 4v.5h-5V4z" />
            </svg>
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCompress}
            disabled={compactor.isProcessing || !compactor.input.trim()}
            className="flex-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {compactor.isProcessing ? 'Processing...' : 'Compress'}
          </button>
          <button
            type="button"
            onClick={handleDecompress}
            disabled={compactor.isProcessing || !compactor.input.trim()}
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Decompress
          </button>
          <select
            value={selectedFormat}
            onChange={(e) => setSelectedFormat(e.target.value as PaktFormat)}
            className="rounded-lg border border-gray-700 bg-gray-800 px-1.5 py-1.5 text-xs text-gray-300 focus:border-indigo-500 focus:outline-none"
          >
            {OUTPUT_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* Layer controls */}
        <LayerControls />

        {/* Output textarea */}
        <div className="relative">
          <textarea
            value={compactor.output}
            readOnly
            placeholder="Output will appear here..."
            rows={6}
            className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800/60 px-2.5 py-2 font-mono text-xs text-gray-300 placeholder-gray-600 focus:outline-none"
          />
          {compactor.output && (
            <button
              type="button"
              onClick={handleCopy}
              title="Copy to clipboard"
              className="absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-gray-400 hover:bg-gray-700 hover:text-gray-200"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          )}
        </div>

        {/* Token bar */}
        <TokenBar
          originalTokens={compactor.originalTokens}
          compressedTokens={compactor.compressedTokens}
        />
      </div>
    </div>
  );
};

export default MenuBarPanel;
