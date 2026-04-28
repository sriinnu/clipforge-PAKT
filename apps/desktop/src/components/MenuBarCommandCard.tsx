/**
 * "Quick Actions" command card with the Read / Pack / Restore buttons
 * and the chip row underneath (format, model, layers, hotkeys, savings).
 *
 * All state is owned by {@link MenuBarPanel}; this component is a pure
 * function of its props.
 */

import FormatBadge from './FormatBadge';

/** Props for {@link MenuBarCommandCard}. */
export interface MenuBarCommandCardProps {
  title: string;
  body: string;
  isProcessing: boolean;
  hasInput: boolean;
  hasOutput: boolean;
  outputHasError: boolean;
  format: string;
  output: string;
  model: string;
  activeLayerCodes: string[];
  showSemanticBudget: boolean;
  semanticBudget: number;
  runIsLossless: boolean;
  packHotkey: string;
  restoreHotkey: string;
  savings: number;
  onRead: () => void;
  onCompress: () => void;
  onRestore: () => void;
}

/**
 * Render the command card. Buttons are disabled while a transform is
 * mid-flight or the source textarea is empty.
 */
export function MenuBarCommandCard({
  title,
  body,
  isProcessing,
  hasInput,
  hasOutput,
  outputHasError,
  format,
  output,
  model,
  activeLayerCodes,
  showSemanticBudget,
  semanticBudget,
  runIsLossless,
  packHotkey,
  restoreHotkey,
  savings,
  onRead,
  onCompress,
  onRestore,
}: MenuBarCommandCardProps) {
  return (
    <section className="desktop-command-card">
      <div className="desktop-command-row">
        <div className="desktop-command-copy">
          <p className="desktop-card-title">Quick Actions</p>
          <h2 className="desktop-command-title">{title}</h2>
          <p className="desktop-copy">{body}</p>
        </div>
        <div className="desktop-command-actions">
          <button type="button" onClick={onRead} className="desktop-secondary-button">
            Read
          </button>
          <button
            type="button"
            onClick={onCompress}
            disabled={isProcessing || !hasInput}
            className="desktop-primary-button"
          >
            Pack
          </button>
          <button
            type="button"
            onClick={onRestore}
            disabled={isProcessing || !hasInput}
            className="desktop-secondary-button"
          >
            Restore
          </button>
        </div>
      </div>

      <div className="desktop-chip-row">
        <FormatBadge format={format} compressedOutput={output} />
        <span className="desktop-hero-chip">{model}</span>
        <span className="desktop-hero-chip">
          {activeLayerCodes.length > 0 ? activeLayerCodes.join(' · ') : 'No layers'}
        </span>
        {showSemanticBudget ? (
          <span className="desktop-hero-chip">Budget {semanticBudget}</span>
        ) : null}
        <span className={`desktop-hero-chip ${runIsLossless ? 'is-strong' : 'is-danger'}`}>
          {runIsLossless ? 'Lossless' : 'Lossy'}
        </span>
        <span className="desktop-hero-chip">
          {runIsLossless ? 'Reversible' : 'Not fully reversible'}
        </span>
        <span className="desktop-hero-chip">Pack {packHotkey}</span>
        <span className="desktop-hero-chip">Restore {restoreHotkey}</span>
        {hasOutput && !outputHasError ? (
          <span className="desktop-hero-chip is-strong">{savings}% saved</span>
        ) : null}
        {outputHasError ? <span className="desktop-hero-chip is-danger">Fix output</span> : null}
      </div>
    </section>
  );
}
