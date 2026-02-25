/**
 * ActionBar renders the compress/decompress buttons with:
 * - Loading spinner animation while processing
 * - Keyboard shortcut hints as tooltips
 * - Disabled state during compression
 */

import type { PaktFormat } from '@yugenlab/pakt';
import { CompressIcon, DecompressIcon, SpinnerIcon } from './icons';
import { primaryBtnStyle, secondaryBtnStyle, selectStyle } from './styles';

/** Detect whether the user is on macOS for shortcut display. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
/** Modifier key label for keyboard shortcut tooltips. */
const MOD = IS_MAC ? '\u2318' : 'Ctrl';

/** Props for ActionBar. */
interface ActionBarProps {
  /** Whether detected format is PAKT (shows decompress UI). */
  isPakt: boolean;
  /** Whether the input textarea has content. */
  hasInput: boolean;
  /** Whether a compress/decompress operation is in progress. */
  processing: boolean;
  /** Currently selected decompress target format. */
  decompressFormat: PaktFormat;
  /** Called when the decompress format dropdown changes. */
  onDecompressFormatChange: (fmt: PaktFormat) => void;
  /** Compress button click handler. */
  onCompress: () => void;
  /** Decompress button click handler. */
  onDecompress: () => void;
}

/**
 * Renders either a single Compress button or a Decompress dropdown + button,
 * depending on whether the input is already in PAKT format.
 */
export function ActionBar({
  isPakt,
  hasInput,
  processing,
  decompressFormat,
  onDecompressFormatChange,
  onCompress,
  onDecompress,
}: ActionBarProps) {
  const disabled = !hasInput || processing;

  if (!isPakt) {
    return (
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          style={{
            ...primaryBtnStyle,
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
          onClick={onCompress}
          disabled={disabled}
          title={`Compress (${MOD}+Enter)`}
        >
          {processing ? <SpinnerIcon /> : <CompressIcon />}
          {processing ? 'Compressing...' : 'Compress'}
        </button>
      </div>
    );
  }

  /* PAKT input detected — show decompress UI */
  return (
    <div style={{ display: 'flex', gap: 8, width: '100%' }}>
      <select
        style={selectStyle}
        value={decompressFormat}
        onChange={(e) => onDecompressFormatChange(e.target.value as PaktFormat)}
      >
        <option value="json">JSON</option>
        <option value="yaml">YAML</option>
        <option value="csv">CSV</option>
        <option value="markdown">Markdown</option>
      </select>
      <button
        type="button"
        style={{
          ...secondaryBtnStyle,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        onClick={onDecompress}
        disabled={disabled}
        title={`Decompress (${MOD}+Enter)`}
      >
        {processing ? <SpinnerIcon /> : <DecompressIcon />}
        {processing ? 'Expanding...' : 'Decompress'}
      </button>
    </div>
  );
}
