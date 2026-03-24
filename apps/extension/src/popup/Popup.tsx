/**
 * Main ClipForge popup component.
 *
 * Handles text input, format detection, auto-compress, keyboard shortcuts,
 * and output copying. Compression/decompression logic lives in `useCompression`.
 */

import { detect, getPaktLayerProfile } from '@sriinnu/pakt';
import type { PaktFormat } from '@sriinnu/pakt';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupportedSite, listSupportedSiteLabels } from '../shared/site-support';
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
import { useCompression } from './useCompression';
import { useTheme } from './useTheme';

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
const MOD = IS_MAC ? '\u2318' : 'Ctrl';
const MCP_CONFIG_SNIPPET = JSON.stringify(
  {
    mcpServers: {
      pakt: {
        command: 'npx',
        args: ['-y', '@sriinnu/pakt', 'serve', '--stdio'],
      },
    },
  },
  null,
  2,
);

function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function buildCliWorkflowSnippet(input: string): string {
  const payload =
    input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim() ||
    '{"paste":"structured payload here","tip":"run pakt inspect first"}';
  const payloadBase64 = encodeBase64(payload);
  const decodeCommand = `node --input-type=module -e "process.stdout.write(Buffer.from('${payloadBase64}','base64').toString('utf8'))"`;
  return [`${decodeCommand} | pakt inspect`, `${decodeCommand} | pakt auto`].join('\n');
}

function AutoCompressNotice() {
  return <div style={autoNoticeStyle}>Auto-compressed locally on paste</div>;
}

type ActiveTabSupport = {
  status: 'loading' | 'supported' | 'unsupported' | 'unknown';
  hostname: string | null;
  label: string | null;
};

const SUPPORTED_SITE_LABELS = listSupportedSiteLabels();

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
  const [activeTabSupport, setActiveTabSupport] = useState<ActiveTabSupport>({
    status: 'loading',
    hostname: null,
    label: null,
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoCompressedRef = useRef(false);

  useTheme();

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
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
      setActiveTabSupport({ status: 'unknown', hostname: null, label: null });
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        setActiveTabSupport({ status: 'unknown', hostname: null, label: null });
        return;
      }

      const rawUrl = tabs[0]?.url;
      if (!rawUrl) {
        setActiveTabSupport({ status: 'unknown', hostname: null, label: null });
        return;
      }

      try {
        const hostname = new URL(rawUrl).hostname;
        const supportedSite = getSupportedSite(hostname);
        setActiveTabSupport({
          status: supportedSite ? 'supported' : 'unsupported',
          hostname,
          label: supportedSite?.label ?? null,
        });
      } catch {
        setActiveTabSupport({ status: 'unknown', hostname: null, label: null });
      }
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
    { setOutput, setStats, setStatusMsg, setProcessing },
  );

  const handleCompress = useCallback(() => {
    runCompress(input);
  }, [input, runCompress]);

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
          setTimeout(() => setAutoNotice(false), 2500);
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
  const siteSupportTitle =
    activeTabSupport.status === 'supported'
      ? `Inline support active on ${activeTabSupport.label}`
      : activeTabSupport.status === 'unsupported'
        ? `Inline support not available on ${activeTabSupport.hostname}`
        : 'Inline site support unavailable';
  const siteSupportBody =
    activeTabSupport.status === 'supported'
      ? 'This tab supports the inline ClipForge pill. You can still use the popup locally and copy the result back into the chat box when you want tighter control.'
      : activeTabSupport.status === 'unsupported'
        ? `This popup still works locally, but inline injection is currently validated for ${SUPPORTED_SITE_LABELS}. Use Copy Result here or move repeated workflows into the CLI or MCP server.`
        : `The popup can still compress locally. Inline injection is currently validated for ${SUPPORTED_SITE_LABELS}.`;
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
        />
        <p
          style={{
            marginTop: 8,
            color: 'var(--cf-text-muted)',
            fontSize: 11,
            lineHeight: 1.45,
          }}
        >
          Paste structured content here, or let the popup load from your clipboard on open.
          Compression stays local in the extension until you copy or paste it elsewhere.
        </p>

        <div
          style={{
            marginTop: 10,
            padding: '10px 12px',
            borderRadius: 12,
            border: '1px solid var(--cf-border)',
            background: 'var(--cf-surface)',
            display: 'grid',
            gap: 4,
          }}
        >
          <strong style={{ fontSize: 12, color: 'var(--cf-text)' }}>{siteSupportTitle}</strong>
          <span style={{ fontSize: 11, color: 'var(--cf-text-muted)', lineHeight: 1.5 }}>
            {siteSupportBody}
          </span>
          {activeTabSupport.status !== 'supported' ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <button
                type="button"
                style={{ ...clearBtnStyle, padding: '6px 10px', fontSize: 11 }}
                onClick={() => void copyWorkflowText('CLI snippet', buildCliWorkflowSnippet(input))}
              >
                Copy CLI snippet
              </button>
              <button
                type="button"
                style={{ ...clearBtnStyle, padding: '6px 10px', fontSize: 11 }}
                onClick={() => void copyWorkflowText('MCP config', MCP_CONFIG_SNIPPET)}
              >
                Copy MCP config
              </button>
            </div>
          ) : null}
        </div>

        <div
          style={{
            marginTop: 10,
            padding: '10px 12px',
            borderRadius: 12,
            border: '1px solid var(--cf-border)',
            background: 'var(--cf-surface)',
            display: 'grid',
            gap: 4,
          }}
        >
          <strong style={{ fontSize: 12, color: 'var(--cf-text)' }}>
            Active compression profile
          </strong>
          <span style={{ fontSize: 11, color: 'var(--cf-text)', lineHeight: 1.5 }}>
            {profileSummary}
          </span>
          <span style={{ fontSize: 11, color: 'var(--cf-text-muted)', lineHeight: 1.5 }}>
            {profileDetail}
          </span>
          <span style={{ fontSize: 11, color: 'var(--cf-text-dim)', lineHeight: 1.5 }}>
            {profileHonesty}
          </span>
        </div>

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

        {statusMsg && (
          <div
            style={{
              ...statusMsgStyle,
              backgroundColor:
                statusMsg.type === 'success'
                  ? 'var(--cf-success-glow)'
                  : statusMsg.type === 'info'
                    ? 'var(--cf-surface)'
                    : 'var(--cf-error-glow)',
              color:
                statusMsg.type === 'success'
                  ? 'var(--cf-success)'
                  : statusMsg.type === 'info'
                    ? 'var(--cf-text-muted)'
                    : 'var(--cf-error)',
            }}
          >
            {statusMsg.text}
          </div>
        )}
      </div>

      <div style={footerStyle}>
        <span style={{ color: 'var(--cf-text-dim)', fontSize: 11 }}>
          {isPakt ? `${MOD}+Enter to expand` : `${MOD}+Enter to compress`}
        </span>
        <a
          href="https://github.com/sriinnu/clipforge-PAKT#readme"
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
