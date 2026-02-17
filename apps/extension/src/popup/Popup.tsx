import { useState, useCallback, useEffect, useRef } from 'react';
import { compress, decompress, detect, countTokens } from '@yugenlab/pakt';
import type { PaktFormat, PaktResult, DecompressResult } from '@yugenlab/pakt';
import { Settings } from './Settings';
import { getSettings, type ExtensionSettings } from '../shared/storage';

// ---------------------------------------------------------------------------
// CSS custom properties injected into the root element
// ---------------------------------------------------------------------------
const CSS_VARS = `
  :root {
    --cf-bg: #0f0d1a;
    --cf-surface: #1a1730;
    --cf-surface-hover: #241f3a;
    --cf-accent: #7c3aed;
    --cf-accent-hover: #6d28d9;
    --cf-accent-glow: rgba(124, 58, 237, 0.15);
    --cf-success: #22c55e;
    --cf-success-glow: rgba(34, 197, 94, 0.15);
    --cf-error: #ef4444;
    --cf-error-glow: rgba(239, 68, 68, 0.15);
    --cf-text: #e8e6f0;
    --cf-text-muted: #8b85a0;
    --cf-text-dim: #5e586f;
    --cf-border: #2a2545;
    --cf-border-focus: #7c3aed;
    --cf-radius-lg: 12px;
    --cf-radius-md: 8px;
    --cf-radius-sm: 6px;
    --cf-radius-pill: 100px;
    --cf-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    --cf-font-mono: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
    --cf-transition: 0.2s ease;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    width: 350px;
    max-height: 500px;
    overflow-y: auto;
    background: var(--cf-bg);
    color: var(--cf-text);
    font-family: var(--cf-font);
    font-size: 13px;
    line-height: 1.4;
    -webkit-font-smoothing: antialiased;
  }

  body::-webkit-scrollbar { width: 4px; }
  body::-webkit-scrollbar-track { background: transparent; }
  body::-webkit-scrollbar-thumb { background: var(--cf-border); border-radius: 2px; }

  textarea {
    font-family: var(--cf-font-mono);
    font-size: 12px;
    line-height: 1.6;
  }

  textarea::-webkit-scrollbar { width: 4px; }
  textarea::-webkit-scrollbar-track { background: transparent; }
  textarea::-webkit-scrollbar-thumb { background: var(--cf-border); border-radius: 2px; }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes slideIn {
    from { opacity: 0; transform: translateX(8px); }
    to { opacity: 1; transform: translateX(0); }
  }

  @keyframes copyFlash {
    0% { background-color: var(--cf-accent); }
    50% { background-color: var(--cf-success); }
    100% { background-color: var(--cf-success); }
  }
`;

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

const FORMAT_LABELS: Record<string, string> = {
  json: 'JSON',
  yaml: 'YAML',
  csv: 'CSV',
  markdown: 'Markdown',
  pakt: 'PAKT',
  text: 'Plain Text',
};

// ---------------------------------------------------------------------------
// SVG Icons
// ---------------------------------------------------------------------------

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M6.5 1.5h3l.4 1.8.5.2 1.6-.8 2.1 2.1-.8 1.6.2.5 1.8.4v3l-1.8.4-.2.5.8 1.6-2.1 2.1-1.6-.8-.5.2-.4 1.8h-3l-.4-1.8-.5-.2-1.6.8L1.9 12l.8-1.6-.2-.5L.7 9.5v-3l1.8-.4.2-.5-.8-1.6L4 1.9l1.6.8.5-.2.4-1.2z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CompressIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M11 3L3 11M3 11V5M3 11h6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DecompressIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M3 11L11 3M11 3v6M11 3H5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10 4V2.5A1.5 1.5 0 008.5 1H2.5A1.5 1.5 0 001 2.5v6A1.5 1.5 0 002.5 10H4" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 7l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
  const [copied, setCopied] = useState(false);
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);

  // Inject CSS custom properties once
  useEffect(() => {
    if (!styleRef.current) {
      const style = document.createElement('style');
      style.textContent = CSS_VARS;
      document.head.appendChild(style);
      styleRef.current = style;
    }
  }, []);

  // Load settings on mount
  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  // Auto-paste from clipboard on open
  useEffect(() => {
    navigator.clipboard.readText().then((text) => {
      if (text && text.trim()) {
        setInput(text);
      }
    }).catch(() => {
      // Clipboard access denied — that's fine
    });
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
    if (!input.trim() || processing) return;
    setStatusMsg(null);
    setProcessing(true);

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
    } finally {
      setProcessing(false);
    }
  }, [input, settings, processing]);

  const handleDecompress = useCallback(() => {
    if (!input.trim() || processing) return;
    setStatusMsg(null);
    setProcessing(true);

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
    } finally {
      setProcessing(false);
    }
  }, [input, decompressFormat, processing]);

  const handleCopy = useCallback(async () => {
    if (!output) return;

    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatusMsg({ text: 'Failed to copy', type: 'error' });
    }
  }, [output]);

  const handleClear = useCallback(() => {
    setInput('');
    setOutput('');
    setStats(null);
    setStatusMsg(null);
    setCopied(false);
    inputRef.current?.focus();
  }, []);

  const isPakt = detectedFormat === 'pakt';
  const formatColor = FORMAT_COLORS[detectedFormat] ?? '#6b7280';
  const formatLabel = FORMAT_LABELS[detectedFormat] ?? detectedFormat;
  const savingsPercent = stats ? Math.round(stats.savings) : 0;

  // Settings overlay
  if (showSettings) {
    return (
      <div style={containerStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              style={backBtnStyle}
              onClick={() => setShowSettings(false)}
              title="Back"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Settings</span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--cf-text-dim)' }}>v0.1.0</span>
        </div>

        <Settings onBack={() => setShowSettings(false)} />
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={logoStyle}>ClipForge</span>
          <span style={versionBadgeStyle}>v0.1.0</span>
        </div>
        <button
          style={gearBtnStyle}
          onClick={() => setShowSettings(true)}
          title="Settings"
        >
          <GearIcon />
        </button>
      </div>

      <div style={bodyStyle}>
        {/* Format detection + clear */}
        <div style={topBarStyle}>
          <div
            style={{
              ...formatBadgeStyle,
              backgroundColor: `${formatColor}18`,
              color: formatColor,
              borderColor: `${formatColor}30`,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: formatColor, display: 'inline-block' }} />
            {formatLabel}
          </div>
          {input.trim() && (
            <button style={clearBtnStyle} onClick={handleClear} title="Clear">
              Clear
            </button>
          )}
        </div>

        {/* Input textarea */}
        <textarea
          ref={inputRef}
          style={textareaStyle}
          placeholder="Paste content here to compress..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={5}
        />

        {/* Action buttons */}
        <div style={actionBarStyle}>
          {!isPakt ? (
            <button
              style={{
                ...primaryBtnStyle,
                opacity: !input.trim() || processing ? 0.5 : 1,
                cursor: !input.trim() || processing ? 'not-allowed' : 'pointer',
              }}
              onClick={handleCompress}
              disabled={!input.trim() || processing}
            >
              <CompressIcon />
              {processing ? 'Compressing...' : 'Compress'}
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <select
                style={selectStyle}
                value={decompressFormat}
                onChange={(e) => setDecompressFormat(e.target.value as PaktFormat)}
              >
                <option value="json">JSON</option>
                <option value="yaml">YAML</option>
                <option value="csv">CSV</option>
                <option value="markdown">Markdown</option>
              </select>
              <button
                style={{
                  ...secondaryBtnStyle,
                  opacity: !input.trim() || processing ? 0.5 : 1,
                  cursor: !input.trim() || processing ? 'not-allowed' : 'pointer',
                }}
                onClick={handleDecompress}
                disabled={!input.trim() || processing}
              >
                <DecompressIcon />
                {processing ? 'Expanding...' : 'Decompress'}
              </button>
            </div>
          )}
        </div>

        {/* Stats bar */}
        {stats && (
          <div style={statsCardStyle}>
            <div style={statsRowStyle}>
              <div style={statItemStyle}>
                <span style={statLabelStyle}>Before</span>
                <span style={statValueStyle}>{stats.before.toLocaleString()}</span>
              </div>
              <div style={{ color: 'var(--cf-text-dim)', fontSize: 16 }}>
                {'\u2192'}
              </div>
              <div style={statItemStyle}>
                <span style={statLabelStyle}>After</span>
                <span style={statValueStyle}>{stats.after.toLocaleString()}</span>
              </div>
              <div style={statItemStyle}>
                <span style={statLabelStyle}>Saved</span>
                <span style={{
                  ...statValueStyle,
                  color: savingsPercent > 0 ? 'var(--cf-success)' : 'var(--cf-text-dim)',
                }}>
                  {savingsPercent > 0 ? `${savingsPercent}%` : '--'}
                </span>
              </div>
            </div>
            {/* Progress bar */}
            {savingsPercent > 0 && (
              <div style={progressBarBgStyle}>
                <div
                  style={{
                    ...progressBarFillStyle,
                    width: `${Math.min(100, savingsPercent)}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Output */}
        {output && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, animation: 'fadeIn 0.2s ease' }}>
            <span style={outputLabelStyle}>Output</span>
            <textarea
              style={{ ...textareaStyle, minHeight: 80, backgroundColor: 'var(--cf-surface)' }}
              value={output}
              readOnly
            />
            <button
              style={{
                ...copyBtnStyle,
                backgroundColor: copied ? 'var(--cf-success)' : 'var(--cf-accent)',
              }}
              onClick={handleCopy}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? 'Copied!' : 'Copy Result'}
            </button>
          </div>
        )}

        {/* Status message */}
        {statusMsg && (
          <div
            style={{
              ...statusMsgStyle,
              backgroundColor: statusMsg.type === 'success' ? 'var(--cf-success-glow)' : 'var(--cf-error-glow)',
              color: statusMsg.type === 'success' ? 'var(--cf-success)' : 'var(--cf-error)',
            }}
          >
            {statusMsg.text}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        <span style={{ color: 'var(--cf-text-dim)', fontSize: 11 }}>PAKT compression</span>
        <a
          href="https://github.com/yugenlab/clipforge"
          target="_blank"
          rel="noopener noreferrer"
          style={footerLinkStyle}
        >
          Docs
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style objects
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  width: 350,
  maxHeight: 500,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: 'var(--cf-bg)',
  color: 'var(--cf-text)',
  fontFamily: 'var(--cf-font)',
  fontSize: 13,
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  borderBottom: '1px solid var(--cf-border)',
  flexShrink: 0,
};

const logoStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: 'var(--cf-accent)',
  letterSpacing: -0.3,
};

const versionBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--cf-text-dim)',
  backgroundColor: 'var(--cf-surface)',
  padding: '1px 6px',
  borderRadius: 'var(--cf-radius-pill)',
  fontWeight: 500,
};

const gearBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--cf-text-muted)',
  cursor: 'pointer',
  padding: 4,
  borderRadius: 'var(--cf-radius-sm)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'color var(--cf-transition)',
};

const backBtnStyle: React.CSSProperties = {
  ...gearBtnStyle,
  padding: 2,
};

const bodyStyle: React.CSSProperties = {
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  flex: 1,
  overflowY: 'auto',
};

const topBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const formatBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 10px',
  borderRadius: 'var(--cf-radius-pill)',
  fontSize: 11,
  fontWeight: 600,
  border: '1px solid',
  letterSpacing: 0.2,
};

const clearBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--cf-text-dim)',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 500,
  padding: '2px 6px',
  borderRadius: 'var(--cf-radius-sm)',
  transition: 'color var(--cf-transition)',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 100,
  padding: '10px 12px',
  backgroundColor: 'var(--cf-surface)',
  color: 'var(--cf-text)',
  border: '1px solid var(--cf-border)',
  borderRadius: 'var(--cf-radius-md)',
  resize: 'vertical',
  fontFamily: 'var(--cf-font-mono)',
  fontSize: 12,
  lineHeight: 1.6,
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color var(--cf-transition)',
};

const actionBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};

const primaryBtnStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '9px 16px',
  borderRadius: 'var(--cf-radius-md)',
  border: 'none',
  backgroundColor: 'var(--cf-accent)',
  color: '#fff',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  transition: 'all var(--cf-transition)',
  fontFamily: 'var(--cf-font)',
};

const secondaryBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  backgroundColor: 'var(--cf-surface)',
  border: '1px solid var(--cf-border)',
};

const selectStyle: React.CSSProperties = {
  padding: '8px 10px',
  backgroundColor: 'var(--cf-surface)',
  color: 'var(--cf-text)',
  border: '1px solid var(--cf-border)',
  borderRadius: 'var(--cf-radius-md)',
  fontSize: 12,
  outline: 'none',
  fontFamily: 'var(--cf-font)',
  cursor: 'pointer',
};

const statsCardStyle: React.CSSProperties = {
  padding: '10px 12px',
  backgroundColor: 'var(--cf-surface)',
  borderRadius: 'var(--cf-radius-lg)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  animation: 'fadeIn 0.25s ease',
};

const statsRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const statItemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
};

const statLabelStyle: React.CSSProperties = {
  color: 'var(--cf-text-dim)',
  fontSize: 10,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const statValueStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 15,
};

const progressBarBgStyle: React.CSSProperties = {
  width: '100%',
  height: 4,
  backgroundColor: 'var(--cf-border)',
  borderRadius: 2,
  overflow: 'hidden',
};

const progressBarFillStyle: React.CSSProperties = {
  height: '100%',
  backgroundColor: 'var(--cf-success)',
  borderRadius: 2,
  transition: 'width 0.4s ease',
};

const outputLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--cf-text-dim)',
  textTransform: 'uppercase',
  fontWeight: 600,
  letterSpacing: 0.5,
};

const copyBtnStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '9px 16px',
  borderRadius: 'var(--cf-radius-md)',
  border: 'none',
  color: '#fff',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  transition: 'background-color 0.3s ease',
  fontFamily: 'var(--cf-font)',
};

const statusMsgStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 'var(--cf-radius-md)',
  fontSize: 12,
  fontWeight: 500,
  animation: 'fadeIn 0.2s ease',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 14px',
  borderTop: '1px solid var(--cf-border)',
  flexShrink: 0,
};

const footerLinkStyle: React.CSSProperties = {
  color: 'var(--cf-text-dim)',
  fontSize: 11,
  textDecoration: 'none',
  fontWeight: 500,
  transition: 'color var(--cf-transition)',
};
