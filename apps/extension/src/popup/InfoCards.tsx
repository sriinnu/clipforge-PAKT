/**
 * @module InfoCards
 * Extracted card components for the ClipForge popup — site-support status
 * and active compression profile. Keeps Popup.tsx under the 400-line limit.
 */

import { clearBtnStyle } from './styles';

/** Shared card wrapper style used by both info cards. */
const cardStyle: React.CSSProperties = {
  marginTop: 10,
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid var(--cf-border)',
  background: 'var(--cf-surface)',
  display: 'grid',
  gap: 4,
};

// ---- Site Support Card ------------------------------------------------------

interface SiteSupportCardProps {
  /** Whether the active tab is supported, unsupported, or unknown. */
  status: 'loading' | 'supported' | 'unsupported' | 'unknown';
  /** Title line for the card. */
  title: string;
  /** Body text describing site support. */
  body: string;
  /** Callback to copy the CLI workflow snippet. */
  onCopyCliSnippet: () => void;
  /** Callback to copy the MCP server config. */
  onCopyMcpConfig: () => void;
}

/**
 * Displays whether the current tab supports inline ClipForge injection,
 * with fallback buttons for CLI and MCP workflows.
 */
export function SiteSupportCard({
  status,
  title,
  body,
  onCopyCliSnippet,
  onCopyMcpConfig,
}: SiteSupportCardProps) {
  return (
    <div style={cardStyle}>
      <strong style={{ fontSize: 12, color: 'var(--cf-text)' }}>{title}</strong>
      <span style={{ fontSize: 11, color: 'var(--cf-text-muted)', lineHeight: 1.5 }}>{body}</span>
      {status !== 'supported' ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <button
            type="button"
            style={{ ...clearBtnStyle, padding: '6px 10px', fontSize: 11 }}
            onClick={onCopyCliSnippet}
          >
            Copy CLI snippet
          </button>
          <button
            type="button"
            style={{ ...clearBtnStyle, padding: '6px 10px', fontSize: 11 }}
            onClick={onCopyMcpConfig}
          >
            Copy MCP config
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---- Profile Card -----------------------------------------------------------

interface ProfileCardProps {
  /** User-facing summary string (e.g. "Standard (std)"). */
  summary: string;
  /** Description of the profile. */
  detail: string;
  /** Reversibility / honesty disclaimer. */
  honesty: string;
}

/**
 * Shows the currently active compression profile with its label,
 * description, and reversibility status.
 */
export function ProfileCard({ summary, detail, honesty }: ProfileCardProps) {
  return (
    <div style={cardStyle}>
      <strong style={{ fontSize: 12, color: 'var(--cf-text)' }}>Active compression profile</strong>
      <span style={{ fontSize: 11, color: 'var(--cf-text)', lineHeight: 1.5 }}>{summary}</span>
      <span style={{ fontSize: 11, color: 'var(--cf-text-muted)', lineHeight: 1.5 }}>{detail}</span>
      <span style={{ fontSize: 11, color: 'var(--cf-text-dim)', lineHeight: 1.5 }}>{honesty}</span>
    </div>
  );
}
