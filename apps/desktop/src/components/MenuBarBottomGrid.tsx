/**
 * Bottom row of the menu-bar panel: layer-controls block on the left,
 * a small utility info card + token bar stacked on the right.
 */

import type { CompressibilityLabel, PaktFormat } from '@sriinnu/pakt';
import LayerControls from './LayerControls';
import TokenBar from './TokenBar';

/** Props for {@link MenuBarBottomGrid}. */
export interface MenuBarBottomGridProps {
  autoCompress: boolean;
  onToggleAutoCompress: () => void;
  model: string;
  outputFormat: PaktFormat;
  originalTokens: number;
  compressedTokens: number;
  compressibilityLabel: CompressibilityLabel | null;
}

/**
 * Render the bottom grid. The utility section is read-only display
 * except for the auto-compress toggle.
 */
export function MenuBarBottomGrid({
  autoCompress,
  onToggleAutoCompress,
  model,
  outputFormat,
  originalTokens,
  compressedTokens,
  compressibilityLabel,
}: MenuBarBottomGridProps) {
  return (
    <div className="desktop-bottom-grid">
      <LayerControls />

      <div className="desktop-side-stack">
        <section className="desktop-card">
          <div className="desktop-card-inner desktop-utility-grid">
            <div className="desktop-utility-item">
              <span className="desktop-section-title">Clipboard Watch</span>
              <div className="desktop-utility-toggle-row">
                <span className="desktop-utility-value">
                  {autoCompress ? 'Enabled' : 'Disabled'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoCompress}
                  onClick={onToggleAutoCompress}
                  className={`desktop-toggle ${autoCompress ? 'is-on' : ''}`}
                >
                  <span className="desktop-toggle-thumb" />
                </button>
              </div>
            </div>

            <div className="desktop-utility-item">
              <span className="desktop-section-title">Token Model</span>
              <span className="desktop-utility-value">{model}</span>
            </div>

            <div className="desktop-utility-item">
              <span className="desktop-section-title">Restore Format</span>
              <span className="desktop-utility-value">{outputFormat.toUpperCase()}</span>
            </div>
          </div>
        </section>

        <TokenBar
          originalTokens={originalTokens}
          compressedTokens={compressedTokens}
          compressibilityLabel={compressibilityLabel}
        />
      </div>
    </div>
  );
}
