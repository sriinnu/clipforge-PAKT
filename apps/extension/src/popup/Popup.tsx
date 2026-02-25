/**
 * Main ClipForge popup component.
 *
 * Handles text input, format detection, compression/decompression,
 * auto-compress, keyboard shortcuts, and output copying.
 * Sub-components: ActionBar, StatsCard, Settings, icons, styles.
 */

import { compress, countTokens, decompress, detect } from '@yugenlab/pakt';
import type { DecompressResult, PaktFormat, PaktResult } from '@yugenlab/pakt';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ExtensionSettings, getSettings } from '../shared/storage';
import { ActionBar } from './ActionBar';
import { Settings } from './Settings';
import { StatsCard } from './StatsCard';
import { BackIcon, CheckIcon, CopyIcon, GearIcon } from './icons';
import {
  FORMAT_COLORS,
  FORMAT_LABELS,
  FORMAT_TOOLTIPS,
  backBtnStyle,
  bodyStyle,
  clearBtnStyle,
  containerStyle,
  copyBtnStyle,
  footerLinkStyle,
  footerStyle,
  formatBadgeStyle,
  gearBtnStyle,
  headerStyle,
  logoStyle,
  outputLabelStyle,
  statusMsgStyle,
  textareaStyle,
  topBarStyle,
  versionBadgeStyle,
} from './styles';
import { useTheme } from './useTheme';

/** Detect macOS for keyboard shortcut display. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
/** Modifier key label. */
const MOD = IS_MAC ? '\u2318' : 'Ctrl';

/** Auto-compress notification banner. */
function AutoCompressNotice() {
  return <div style={autoNoticeStyle}>Auto-compressed on paste</div>;
}

/** Main popup UI entry point. */
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
  const [autoNotice, setAutoNotice] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Tracks whether auto-compress already fired for the current input. */
  const autoCompressedRef = useRef(false);

  /* Apply theme (dark/light/system) from storage */
  useTheme();

  /* Load settings on mount */
  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  /* Auto-paste from clipboard on open */
  useEffect(() => {
    navigator.clipboard
      .readText()
      .then((text) => {
        if (text?.trim()) setInput(text);
      })
      .catch(() => {
        /* clipboard access denied */
      });
  }, []);

  /* Auto-detect format when input changes */
  useEffect(() => {
    if (!input.trim()) {
      setDetectedFormat('text');
      return;
    }
    try {
      setDetectedFormat(detect(input).format);
    } catch {
      setDetectedFormat('text');
    }
  }, [input]);

  /* ---- Core compression handler ---- */
  const runCompress = useCallback(
    (text: string, isAuto = false) => {
      if (!text.trim() || processing) return;
      setStatusMsg(null);
      setProcessing(true);
      try {
        const result: PaktResult = compress(text, {
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
        if (isAuto) {
          setAutoNotice(true);
          setTimeout(() => setAutoNotice(false), 2500);
        }
      } catch (err) {
        setStatusMsg({
          text: err instanceof Error ? err.message : 'Compression failed',
          type: 'error',
        });
      } finally {
        setProcessing(false);
      }
    },
    [settings, processing],
  );

  /** Compress button click handler. */
  const handleCompress = useCallback(() => {
    runCompress(input);
  }, [input, runCompress]);

  /** Decompress button click handler. */
  const handleDecompress = useCallback(() => {
    if (!input.trim() || processing) return;
    setStatusMsg(null);
    setProcessing(true);
    try {
      const result: DecompressResult = decompress(input, decompressFormat);
      setOutput(result.text);
      const beforeTokens = countTokens(input);
      const afterTokens = countTokens(result.text);
      setStats({ before: beforeTokens, after: afterTokens, savings: 0 });
    } catch (err) {
      setStatusMsg({
        text: err instanceof Error ? err.message : 'Decompression failed',
        type: 'error',
      });
    } finally {
      setProcessing(false);
    }
  }, [input, decompressFormat, processing]);

  /** Copy output to clipboard. */
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

  /** Clear all state and refocus input. */
  const handleClear = useCallback(() => {
    setInput('');
    setOutput('');
    setStats(null);
    setStatusMsg(null);
    setCopied(false);
    autoCompressedRef.current = false;
    inputRef.current?.focus();
  }, []);

  /* ---- Auto-compress when enabled and text is pasted/loaded ---- */
  useEffect(() => {
    if (!settings?.autoCompress) return;
    if (!input.trim()) {
      autoCompressedRef.current = false;
      return;
    }
    if (autoCompressedRef.current) return;
    /* Skip if already PAKT */
    try {
      if (detect(input).format === 'pakt') return;
    } catch {
      /* ignore */
    }
    autoCompressedRef.current = true;
    /* Small delay so the UI shows the pasted text first */
    const timer = setTimeout(() => runCompress(input, true), 150);
    return () => clearTimeout(timer);
  }, [input, settings?.autoCompress, runCompress]);

  /* ---- Keyboard shortcuts ---- */

  /** Check whether the platform modifier key (Cmd on Mac, Ctrl otherwise) is held. */
  const hasMod = useCallback((e: KeyboardEvent) => (IS_MAC ? e.metaKey : e.ctrlKey), []);

  /** Handle a single keyboard shortcut event, returning true if handled. */
  const handleShortcut = useCallback(
    (e: KeyboardEvent): boolean => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (detectedFormat === 'pakt') handleDecompress();
        else handleCompress();
        return true;
      }
      if (e.key === 'C' && e.shiftKey) {
        e.preventDefault();
        handleCopy();
        return true;
      }
      return false;
    },
    [detectedFormat, handleCompress, handleDecompress, handleCopy],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!hasMod(e)) return;
      handleShortcut(e);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hasMod, handleShortcut]);

  /* ---- Derived values ---- */
  const isPakt = detectedFormat === 'pakt';
  const formatColor = FORMAT_COLORS[detectedFormat] ?? '#6b7280';
  const formatLabel = FORMAT_LABELS[detectedFormat] ?? detectedFormat;
  const formatTooltip = FORMAT_TOOLTIPS[detectedFormat] ?? '';

  /* ---- Settings overlay ---- */
  if (showSettings) {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              style={backBtnStyle}
              onClick={() => setShowSettings(false)}
              title="Back"
            >
              <BackIcon />
            </button>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Settings</span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--cf-text-dim)' }}>v0.1.0</span>
        </div>
        <div style={{ animation: 'slideInFromRight 0.2s ease' }}>
          <Settings onBack={() => setShowSettings(false)} />
        </div>
      </div>
    );
  }

  /* ---- Main UI ---- */
  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={logoStyle}>ClipForge</span>
          <span style={versionBadgeStyle}>v0.1.0</span>
        </div>
        <button
          type="button"
          style={gearBtnStyle}
          onClick={() => setShowSettings(true)}
          title="Settings"
        >
          <GearIcon />
        </button>
      </div>

      <div style={bodyStyle}>
        {/* Auto-compress notification */}
        {autoNotice && <AutoCompressNotice />}

        {/* Format detection badge + clear */}
        <div style={topBarStyle}>
          <div
            style={{
              ...formatBadgeStyle,
              backgroundColor: `${formatColor}18`,
              color: formatColor,
              borderColor: `${formatColor}30`,
            }}
            title={formatTooltip}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: formatColor,
                display: 'inline-block',
              }}
            />
            {formatLabel}
          </div>
          {input.trim() && (
            <button type="button" style={clearBtnStyle} onClick={handleClear} title="Clear">
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

        {/* Action buttons (compress / decompress) */}
        <ActionBar
          isPakt={isPakt}
          hasInput={!!input.trim()}
          processing={processing}
          decompressFormat={decompressFormat}
          onDecompressFormatChange={setDecompressFormat}
          onCompress={handleCompress}
          onDecompress={handleDecompress}
        />

        {/* Stats card with skeleton loading */}
        <StatsCard stats={stats} loading={processing} />

        {/* Output section */}
        {output && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              animation: 'fadeIn 0.2s ease',
            }}
          >
            <span style={outputLabelStyle}>Output</span>
            <textarea
              style={{ ...textareaStyle, minHeight: 80, backgroundColor: 'var(--cf-surface)' }}
              value={output}
              readOnly
            />
            <button
              type="button"
              style={{
                ...copyBtnStyle,
                backgroundColor: copied ? 'var(--cf-success)' : 'var(--cf-accent)',
              }}
              onClick={handleCopy}
              title={`Copy result (${MOD}+Shift+C)`}
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
              backgroundColor:
                statusMsg.type === 'success' ? 'var(--cf-success-glow)' : 'var(--cf-error-glow)',
              color: statusMsg.type === 'success' ? 'var(--cf-success)' : 'var(--cf-error)',
            }}
          >
            {statusMsg.text}
          </div>
        )}
      </div>

      {/* Footer with keyboard shortcut hints */}
      <div style={footerStyle}>
        <span style={{ color: 'var(--cf-text-dim)', fontSize: 11 }}>{MOD}+Enter to compress</span>
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

/* -- Inline styles for auto-compress notification ------------------------- */

/** Slide-down notification banner for auto-compress events. */
const autoNoticeStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 'var(--cf-radius-md)',
  backgroundColor: 'var(--cf-accent-glow)',
  color: 'var(--cf-accent)',
  fontSize: 11,
  fontWeight: 500,
  textAlign: 'center',
  animation: 'notificationSlide 2.5s ease forwards',
};
