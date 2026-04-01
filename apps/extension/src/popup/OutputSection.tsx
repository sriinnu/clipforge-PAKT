/**
 * @module OutputSection
 * Renders the compressed/decompressed output area with copy button,
 * delta encoding chip, and status messages.
 */

import { CheckIcon, CopyIcon } from './icons';
import { copyBtnStyle, outputLabelStyle, statusMsgStyle, textareaStyle } from './styles';

/** Delta chip style — purple accent for delta-encoded outputs. */
const deltaChipStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  padding: '1px 6px',
  borderRadius: 4,
  backgroundColor: 'var(--cf-accent-glow)',
  color: 'var(--cf-accent)',
  border: '1px solid var(--cf-accent)',
};

interface OutputSectionProps {
  /** Compressed or decompressed output text. */
  output: string;
  /** Whether the output was copied to clipboard. */
  copied: boolean;
  /** Whether the compressed output uses delta encoding. */
  deltaEncoded: boolean;
  /** Keyboard modifier label for the copy shortcut tooltip. */
  mod: string;
  /** Callback to copy the output to clipboard. */
  onCopy: () => void;
}

/**
 * Output area shown after compression/decompression completes.
 * Includes the output textarea, a copy button, and an optional
 * "Delta" chip when delta encoding is detected in the output.
 */
export function OutputSection({ output, copied, deltaEncoded, mod, onCopy }: OutputSectionProps) {
  if (!output) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        animation: 'fadeIn 0.2s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={outputLabelStyle}>Output</span>
        {/* Delta encoding chip — shown when compressed output uses delta */}
        {deltaEncoded && <span style={deltaChipStyle}>Delta</span>}
      </div>
      <textarea
        style={{ ...textareaStyle, minHeight: 80, backgroundColor: 'var(--cf-surface)' }}
        value={output}
        readOnly
        aria-label="Compressed output"
      />
      <button
        type="button"
        style={{
          ...copyBtnStyle,
          backgroundColor: copied ? 'var(--cf-success)' : 'var(--cf-accent)',
        }}
        onClick={onCopy}
        title={`Copy result (${mod}+Shift+C)`}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? 'Copied!' : 'Copy Result'}
      </button>
    </div>
  );
}

interface StatusMessageProps {
  /** Status message object, or null if no message to display. */
  statusMsg: { text: string; type: 'success' | 'error' | 'info' } | null;
}

/**
 * Renders a colored status message (success, error, or info).
 * Returns null when no message is set.
 */
export function StatusMessage({ statusMsg }: StatusMessageProps) {
  if (!statusMsg) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
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
  );
}
