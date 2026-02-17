import { useState, useCallback, useEffect } from 'react';
import { compress, decompress, detect, countTokens } from '@yugenlab/pakt';
import type { PaktFormat, PaktResult, DecompressResult } from '@yugenlab/pakt';
import { Settings } from './Settings';
import { getSettings, type ExtensionSettings } from '../shared/storage';

// ---------------------------------------------------------------------------
// Brand colors
// ---------------------------------------------------------------------------
const C = {
  primary: '#7c3aed',
  primaryHover: '#6d28d9',
  success: '#22c55e',
  bg: '#1e1b2e',
  surface: '#2d2640',
  surfaceHover: '#3a3355',
  text: '#e2e0ea',
  textMuted: '#9e99b0',
  border: '#443d5a',
  error: '#ef4444',
} as const;

// ---------------------------------------------------------------------------
// Format badge colors
// ---------------------------------------------------------------------------
const FORMAT_COLORS: Record<string, string> = {
  json: '#f59e0b',
  yaml: '#3b82f6',
  csv: '#10b981',
  markdown: '#8b5cf6',
  pakt: '#7c3aed',
  text: '#6b7280',
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = {
  container: {
    width: 350,
    minHeight: 200,
    backgroundColor: C.bg,
    color: C.text,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: 13,
  } as React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: `1px solid ${C.border}`,
  } as React.CSSProperties,
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: C.primary,
    margin: 0,
  } as React.CSSProperties,
  gearBtn: {
    background: 'none',
    border: 'none',
    color: C.textMuted,
    cursor: 'pointer',
    fontSize: 18,
    padding: 4,
  } as React.CSSProperties,
  body: {
    padding: 16,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  } as React.CSSProperties,
  textarea: {
    width: '100%',
    minHeight: 100,
    padding: 10,
    backgroundColor: C.surface,
    color: C.text,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    resize: 'vertical' as const,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 12,
    lineHeight: 1.5,
    outline: 'none',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  badge: (color: string) =>
    ({
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 10,
      fontSize: 11,
      fontWeight: 600,
      backgroundColor: `${color}22`,
      color,
      textTransform: 'uppercase' as const,
    }) as React.CSSProperties,
  row: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  } as React.CSSProperties,
  btn: (bg: string) =>
    ({
      flex: 1,
      padding: '8px 12px',
      borderRadius: 6,
      border: 'none',
      backgroundColor: bg,
      color: '#fff',
      fontWeight: 600,
      fontSize: 13,
      cursor: 'pointer',
    }) as React.CSSProperties,
  statsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 12px',
    backgroundColor: C.surface,
    borderRadius: 6,
    fontSize: 12,
  } as React.CSSProperties,
  stat: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 2,
  } as React.CSSProperties,
  statLabel: {
    color: C.textMuted,
    fontSize: 10,
    textTransform: 'uppercase' as const,
  } as React.CSSProperties,
  statValue: {
    fontWeight: 700,
    fontSize: 14,
  } as React.CSSProperties,
  outputLabel: {
    fontSize: 11,
    color: C.textMuted,
    textTransform: 'uppercase' as const,
    marginBottom: -4,
  } as React.CSSProperties,
  select: {
    padding: '6px 10px',
    backgroundColor: C.surface,
    color: C.text,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    fontSize: 12,
    outline: 'none',
  } as React.CSSProperties,
  status: (type: 'success' | 'error') =>
    ({
      padding: '6px 10px',
      borderRadius: 6,
      fontSize: 12,
      backgroundColor: type === 'success' ? `${C.success}22` : `${C.error}22`,
      color: type === 'success' ? C.success : C.error,
    }) as React.CSSProperties,
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function Popup() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [detectedFormat, setDetectedFormat] = useState<PaktFormat>('text');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [stats, setStats] = useState<{
    before: number;
    after: number;
    savings: number;
  } | null>(null);
  const [statusMsg, setStatusMsg] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);
  const [decompressFormat, setDecompressFormat] = useState<PaktFormat>('json');

  // Load settings on mount
  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  // Auto-detect format when input changes
  useEffect(() => {
    if (!input.trim()) {
      setDetectedFormat('text');
      return;
    }
    try {
      const result = detect(input);
      setDetectedFormat(result.format);
    } catch {
      setDetectedFormat('text');
    }
  }, [input]);

  const handleCompress = useCallback(() => {
    if (!input.trim()) return;
    setStatusMsg(null);

    try {
      const result: PaktResult = compress(input, {
        layers: {
          structural: settings?.layerStructural ?? true,
          dictionary: settings?.layerDictionary ?? true,
          tokenizerAware: false,
          semantic: false,
        },
      });

      setOutput(result.compressed);
      setStats({
        before: result.originalTokens,
        after: result.compressedTokens,
        savings: result.savings.totalPercent,
      });
    } catch (err) {
      setStatusMsg({
        text: err instanceof Error ? err.message : 'Compression failed',
        type: 'error',
      });
    }
  }, [input, settings]);

  const handleDecompress = useCallback(() => {
    if (!input.trim()) return;
    setStatusMsg(null);

    try {
      const result: DecompressResult = decompress(input, decompressFormat);
      setOutput(result.text);

      const beforeTokens = countTokens(input);
      const afterTokens = countTokens(result.text);
      setStats({
        before: beforeTokens,
        after: afterTokens,
        savings: 0,
      });
    } catch (err) {
      setStatusMsg({
        text: err instanceof Error ? err.message : 'Decompression failed',
        type: 'error',
      });
    }
  }, [input, decompressFormat]);

  const handleCopy = useCallback(async () => {
    if (!output) return;

    try {
      await navigator.clipboard.writeText(output);
      setStatusMsg({ text: 'Copied to clipboard', type: 'success' });
      setTimeout(() => setStatusMsg(null), 2000);
    } catch {
      setStatusMsg({ text: 'Failed to copy', type: 'error' });
    }
  }, [output]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInput(text);
    } catch {
      setStatusMsg({ text: 'Failed to read clipboard', type: 'error' });
    }
  }, []);

  const isPakt = detectedFormat === 'pakt';
  const formatColor = FORMAT_COLORS[detectedFormat] ?? C.textMuted;

  if (showSettings) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>Settings</h1>
          <button
            style={styles.gearBtn}
            onClick={() => setShowSettings(false)}
            title="Back"
          >
            &larr;
          </button>
        </div>
        <Settings onBack={() => setShowSettings(false)} />
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>ClipForge</h1>
        <button
          style={styles.gearBtn}
          onClick={() => setShowSettings(true)}
          title="Settings"
        >
          &#9881;
        </button>
      </div>

      <div style={styles.body}>
        {/* Input area */}
        <div style={styles.row}>
          <span style={styles.badge(formatColor)}>{detectedFormat}</span>
          <button
            style={{
              ...styles.btn(C.surface),
              flex: 'none',
              padding: '4px 10px',
              fontSize: 11,
            }}
            onClick={handlePaste}
          >
            Paste
          </button>
        </div>

        <textarea
          style={styles.textarea}
          placeholder="Paste or type content here..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />

        {/* Action buttons */}
        <div style={styles.row}>
          {!isPakt && (
            <button
              style={styles.btn(C.primary)}
              onClick={handleCompress}
              disabled={!input.trim()}
            >
              Compress
            </button>
          )}
          {isPakt && (
            <>
              <select
                style={styles.select}
                value={decompressFormat}
                onChange={(e) =>
                  setDecompressFormat(e.target.value as PaktFormat)
                }
              >
                <option value="json">JSON</option>
                <option value="yaml">YAML</option>
                <option value="csv">CSV</option>
                <option value="markdown">Markdown</option>
              </select>
              <button
                style={styles.btn(C.success)}
                onClick={handleDecompress}
                disabled={!input.trim()}
              >
                Decompress
              </button>
            </>
          )}
        </div>

        {/* Stats */}
        {stats && (
          <div style={styles.statsRow}>
            <div style={styles.stat}>
              <span style={styles.statLabel}>Before</span>
              <span style={styles.statValue}>{stats.before}</span>
            </div>
            <div style={styles.stat}>
              <span style={styles.statLabel}>After</span>
              <span style={styles.statValue}>{stats.after}</span>
            </div>
            <div style={styles.stat}>
              <span style={styles.statLabel}>Saved</span>
              <span
                style={{ ...styles.statValue, color: C.success }}
              >
                {stats.savings > 0 ? `${stats.savings}%` : '--'}
              </span>
            </div>
          </div>
        )}

        {/* Output */}
        {output && (
          <>
            <div style={styles.outputLabel}>Output</div>
            <textarea
              style={{ ...styles.textarea, minHeight: 80 }}
              value={output}
              readOnly
            />
            <button style={styles.btn(C.primary)} onClick={handleCopy}>
              Copy to Clipboard
            </button>
          </>
        )}

        {/* Status message */}
        {statusMsg && (
          <div style={styles.status(statusMsg.type)}>{statusMsg.text}</div>
        )}
      </div>
    </div>
  );
}
