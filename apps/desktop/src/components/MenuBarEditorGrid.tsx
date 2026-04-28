/**
 * Side-by-side source + output editor cards for the menu-bar panel.
 *
 * Split into two private sub-components so neither hits the cognitive-
 * complexity threshold and so the orchestrator can pass props as a flat
 * bag.
 */

import type { PaktFormat } from '@sriinnu/pakt';
import type { ChangeEvent, RefObject } from 'react';
import FormatBadge from './FormatBadge';
import { OUTPUT_FORMATS, type TransformAction } from './menu-bar-constants';
import { deriveCopyBadge, deriveOutputStatus } from './menu-bar-helpers';

/** Props for the {@link MenuBarEditorGrid} layout. */
export interface MenuBarEditorGridProps {
  // Source side
  input: string;
  format: string;
  output: string;
  originalTokens: number;
  compressedTokens: number;
  sourceMeta: string;
  outputMeta: string;
  lastAction: TransformAction;
  autoCompress: boolean;
  sourceTextareaRef: RefObject<HTMLTextAreaElement | null>;
  onSourceChange: (text: string) => void;
  onPasteClipboard: () => void;
  // Output side
  hasOutput: boolean;
  outputHasError: boolean;
  outputFormat: PaktFormat;
  copyState: 'idle' | 'success' | 'error';
  runIsLossless: boolean;
  onOutputFormatChange: (format: PaktFormat) => void;
  onCopyOutput: () => void;
}

/** Source (input) editor card. */
function SourceCard(props: MenuBarEditorGridProps) {
  const {
    input,
    format,
    output,
    originalTokens,
    sourceMeta,
    lastAction,
    autoCompress,
    sourceTextareaRef,
    onSourceChange,
    onPasteClipboard,
  } = props;

  return (
    <section className="desktop-card">
      <div className="desktop-card-inner">
        <div className="desktop-card-header">
          <div>
            <div className="desktop-card-title-row">
              <p className="desktop-card-title">Source</p>
              <span className="desktop-card-meta">{originalTokens.toLocaleString()} tokens</span>
            </div>
            <p className="desktop-copy">{sourceMeta}</p>
          </div>
          <button type="button" onClick={onPasteClipboard} className="desktop-inline-action">
            Paste clipboard
          </button>
        </div>

        <textarea
          ref={sourceTextareaRef}
          value={input}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onSourceChange(e.target.value)}
          placeholder="Paste or type content here..."
          rows={11}
          className="desktop-editor"
          aria-label="Source content"
        />

        <div className="desktop-status-line">
          <div className="desktop-inline-metrics">
            <FormatBadge format={format} compressedOutput={output} />
            <span className="desktop-card-meta">
              {lastAction === 'compress' ? 'Packed output is current' : 'Source is current'}
            </span>
          </div>
          <span>{autoCompress ? 'Watching clipboard' : 'Manual mode'}</span>
        </div>
      </div>
    </section>
  );
}

/** Output (read-only) editor card with restore-format selector and copy. */
function OutputCard(props: MenuBarEditorGridProps) {
  const {
    output,
    compressedTokens,
    outputMeta,
    hasOutput,
    outputHasError,
    outputFormat,
    copyState,
    runIsLossless,
    onOutputFormatChange,
    onCopyOutput,
  } = props;

  const statusText = deriveOutputStatus(hasOutput, outputHasError, runIsLossless);
  const badgeText = deriveCopyBadge(copyState, outputHasError);

  return (
    <section className="desktop-card">
      <div className="desktop-card-inner">
        <div className="desktop-card-header desktop-card-header-stack">
          <div>
            <div className="desktop-card-title-row">
              <p className="desktop-card-title">Output</p>
              {hasOutput ? (
                <span className="desktop-card-meta">
                  {compressedTokens.toLocaleString()} tokens
                </span>
              ) : null}
            </div>
            <p className="desktop-copy">{outputMeta}</p>
          </div>
          <div className="desktop-status-actions">
            <select
              value={outputFormat}
              onChange={(e) => onOutputFormatChange(e.target.value as PaktFormat)}
              className="desktop-select desktop-inline-select"
              aria-label="Output format"
            >
              {OUTPUT_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            {!outputHasError && hasOutput ? (
              <button type="button" onClick={onCopyOutput} className="desktop-primary-button">
                Copy output
              </button>
            ) : null}
          </div>
        </div>

        <textarea
          value={output}
          readOnly
          placeholder="Output will appear here..."
          rows={11}
          className="desktop-editor"
          aria-label="Output content"
        />

        <div className="desktop-status-line">
          <span>{statusText}</span>
          {hasOutput ? (
            <span className={`desktop-copy-badge ${copyState}`}>{badgeText}</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Two-column source / output editor grid. */
export function MenuBarEditorGrid(props: MenuBarEditorGridProps) {
  return (
    <div className="desktop-editor-grid">
      <SourceCard {...props} />
      <OutputCard {...props} />
    </div>
  );
}
