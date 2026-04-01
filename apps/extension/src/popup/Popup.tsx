/**
 * Main ClipForge popup component.
 *
 * Handles text input, format detection, auto-compress, keyboard shortcuts,
 * and output copying. Compression/decompression logic lives in `useCompression`.
 */

import { detect, getPaktLayerProfile } from '@sriinnu/pakt';
import type { PaktFormat } from '@sriinnu/pakt';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ExtensionSettings, getSettings } from '../shared/storage';
import { ActionBar } from './ActionBar';
import { ProfileCard, SiteSupportCard } from './InfoCards';
import { OutputSection, StatusMessage } from './OutputSection';
import { Settings } from './Settings';
import { StatsCard } from './StatsCard';
import { IS_MAC, MCP_CONFIG_SNIPPET, MOD, buildCliWorkflowSnippet } from './helpers';
import { BackIcon, GearIcon } from './icons';
import {
  FORMAT_COLORS,
  FORMAT_LABELS,
  FORMAT_TOOLTIPS,
  backBtnStyle,
  bodyStyle,
  clearBtnStyle,
  containerStyle,
  footerLinkStyle,
  footerStyle,
  formatBadgeStyle,
  gearBtnStyle,
  headerStyle,
  logoStyle,
  textareaStyle,
  topBarStyle,
  versionBadgeStyle,
} from './styles';
import { useActiveTab } from './useActiveTab';
import { type CompressibilityInfo, useCompression } from './useCompression';
import { useTheme } from './useTheme';

/** Auto-compress banner shown briefly after paste-triggered compression. */
function AutoCompressNotice() {
  return <div style={autoNoticeStyle}>Auto-compressed locally on paste</div>;
}

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
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const [decompressFormat, setDecompressFormat] = useState<PaktFormat>('json');
  const [copied, setCopied] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [autoNotice, setAutoNotice] = useState(false);
  /** Pre-compression compressibility estimate (score + label). */
  const [compressibility, setCompressibility] = useState<CompressibilityInfo | null>(null);
  /** Whether the compressed output uses delta encoding. */
  const [deltaEncoded, setDeltaEncoded] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoCompressedRef = useRef(false);
  /** Timer ref for copy-feedback reset (prevents leak on unmount). */
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Timer ref for auto-compress notice dismissal (prevents leak on unmount). */
  const autoNoticeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  /* Clear pending timers on unmount to prevent setState-after-unmount leaks. */
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (autoNoticeTimerRef.current) clearTimeout(autoNoticeTimerRef.current);
    };
  }, []);

  useTheme();
  const { activeTabSupport, siteSupportTitle, siteSupportBody } = useActiveTab();

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

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

  const { runCompress, handleDecompress } = useCompression(
    settings,
    processing,
    detectedFormat,
    input,
    decompressFormat,
    { setOutput, setStats, setStatusMsg, setProcessing, setCompressibility, setDeltaEncoded },
  );

  const handleCompress = useCallback(() => {
    runCompress(input);
  }, [input, runCompress]);

  const handleCopy = useCallback(async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
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
    setCompressibility(null);
    setDeltaEncoded(false);
    autoCompressedRef.current = false;
    inputRef.current?.focus();
  }, []);

  const copyWorkflowText = useCallback(
    async (label: 'CLI snippet' | 'MCP config', text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setStatusMsg({ text: `${label} copied`, type: 'info' });
      } catch {
        setStatusMsg({ text: `Failed to copy ${label.toLowerCase()}`, type: 'error' });
      }
    },
    [],
  );

  useEffect(() => {
    if (!settings?.autoCompress) return;
    if (!input.trim()) {
      autoCompressedRef.current = false;
      return;
    }
    if (autoCompressedRef.current) return;
    try {
      if (detect(input).format === 'pakt') return;
    } catch {
      /* ignore */
    }
    autoCompressedRef.current = true;
    const timer = setTimeout(
      () =>
        runCompress(input, true, () => {
          setAutoNotice(true);
          autoNoticeTimerRef.current = setTimeout(() => setAutoNotice(false), 2500);
        }),
      150,
    );
    return () => clearTimeout(timer);
  }, [input, settings?.autoCompress, runCompress]);

  const hasMod = useCallback((e: KeyboardEvent) => (IS_MAC ? e.metaKey : e.ctrlKey), []);

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

  const isPakt = detectedFormat === 'pakt';
  const formatColor = FORMAT_COLORS[detectedFormat] ?? '#6b7280';
  const formatLabel = FORMAT_LABELS[detectedFormat] ?? detectedFormat;
  const formatTooltip = FORMAT_TOOLTIPS[detectedFormat] ?? '';
  const activeProfile = settings ? getPaktLayerProfile(settings.compressionProfileId) : null;
  const profileSummary = activeProfile
    ? `${activeProfile.label} (${activeProfile.shortLabel})${activeProfile.requiresSemanticBudget ? ` · budget ${settings?.semanticBudget}` : ''}`
    : 'Loading profile';
  const profileDetail = activeProfile
    ? activeProfile.description
    : 'The popup, inline button, and context menu all share the same active profile.';
  const profileHonesty = activeProfile
    ? activeProfile.reversible
      ? 'Lossless profile · Reversible by design'
      : 'Semantic profile · May become lossy when it actually shortens the payload'
    : 'Profile status loading';

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
          <span style={{ fontSize: 11, color: 'var(--cf-text-dim)' }}>
            v{__CLIPFORGE_VERSION__}
          </span>
        </div>
        <div style={{ animation: 'slideInFromRight 0.2s ease' }}>
          <Settings onBack={() => setShowSettings(false)} />
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={logoStyle}>ClipForge</span>
          <span style={versionBadgeStyle}>v{__CLIPFORGE_VERSION__}</span>
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
        {autoNotice && <AutoCompressNotice />}

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
          {/* Compressibility badge — shown after estimation */}
          {compressibility && (
            <div
              style={{
                ...formatBadgeStyle,
                backgroundColor: 'var(--cf-accent-glow)',
                color: 'var(--cf-accent)',
                borderColor: 'var(--cf-accent)',
              }}
              title={`Compressibility: ${Math.round(compressibility.score * 100)}%`}
            >
              {compressibility.label.charAt(0).toUpperCase() + compressibility.label.slice(1)}
            </div>
          )}
          {input.trim() && (
            <button type="button" style={clearBtnStyle} onClick={handleClear} title="Clear">
              Clear
            </button>
          )}
        </div>

        <textarea
          ref={inputRef}
          style={textareaStyle}
          placeholder="Paste content here to compress..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={5}
          aria-label="Input text to compress"
        />
        <p style={{ marginTop: 8, color: 'var(--cf-text-muted)', fontSize: 11, lineHeight: 1.45 }}>
          Paste structured content here, or let the popup load from your clipboard on open.
          Compression stays local in the extension until you copy or paste it elsewhere.
        </p>

        <SiteSupportCard
          status={activeTabSupport.status}
          title={siteSupportTitle}
          body={siteSupportBody}
          onCopyCliSnippet={() =>
            void copyWorkflowText('CLI snippet', buildCliWorkflowSnippet(input))
          }
          onCopyMcpConfig={() => void copyWorkflowText('MCP config', MCP_CONFIG_SNIPPET)}
        />

        <ProfileCard summary={profileSummary} detail={profileDetail} honesty={profileHonesty} />

        <ActionBar
          isPakt={isPakt}
          hasInput={!!input.trim()}
          processing={processing}
          decompressFormat={decompressFormat}
          onDecompressFormatChange={setDecompressFormat}
          onCompress={handleCompress}
          onDecompress={handleDecompress}
        />

        <StatsCard stats={stats} loading={processing} />

        <OutputSection
          output={output}
          copied={copied}
          deltaEncoded={deltaEncoded}
          mod={MOD}
          onCopy={handleCopy}
        />

        <StatusMessage statusMsg={statusMsg} />
      </div>

      <div style={footerStyle}>
        <span style={{ color: 'var(--cf-text-dim)', fontSize: 11 }}>
          {isPakt ? `${MOD}+Enter to expand` : `${MOD}+Enter to compress`}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <a
            href="https://github.com/sriinnu/clipforge-PAKT#readme"
            target="_blank"
            rel="noopener noreferrer"
            style={footerLinkStyle}
          >
            Docs
          </a>
          <span style={{ color: 'var(--cf-text-dim)', fontSize: 10 }}>
            {'© 2026 '}
            <a
              href="https://www.npmjs.com/package/@sriinnu/pakt"
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...footerLinkStyle, fontSize: 10 }}
            >
              Sriinnu
            </a>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Ephemeral banner style for auto-compress notification. */
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
