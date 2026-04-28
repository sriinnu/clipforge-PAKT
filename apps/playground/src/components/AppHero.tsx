/**
 * Hero banner + view-mode tabs at the top of the playground.
 *
 * Stateless: parent owns `viewMode` and the hero metadata strings.
 * Extracted so {@link App} stays under the project's 450-LOC cap.
 */

import paktLogo from '../../../../assets/pakt-logo.svg';
import type { ViewMode } from '../app-constants';

/**
 * Props for {@link AppHero}.
 *
 * `detectedFormat` is a free string (rather than a {@link PaktFormat})
 * so this component can render `'pakt'` and any future detector output
 * without coupling to the core enum.
 */
export interface AppHeroProps {
  /** Currently selected view (drives the active tab styling). */
  viewMode: ViewMode;
  /** Format the runtime detected for the current input (e.g. `'json'`). */
  detectedFormat: string;
  /** Short label of the active compression profile (e.g. `'standard'`). */
  profileShortLabel: string;
  /** Human label of the currently loaded sample, or `'Custom'`. */
  currentSampleLabel: string;
  /** Tab-click handler — parent updates `viewMode`. */
  onViewModeChange: (next: ViewMode) => void;
}

/**
 * Render the playground hero (logo, tagline, version metadata) and the
 * Playground / Compare Layers tab strip below it.
 *
 * @example
 * ```tsx
 * <AppHero
 *   viewMode={viewMode}
 *   detectedFormat={detectedFormat}
 *   profileShortLabel={selectedProfile.shortLabel}
 *   currentSampleLabel={currentSample?.label ?? 'Custom'}
 *   onViewModeChange={setViewMode}
 * />
 * ```
 */
export function AppHero({
  viewMode,
  detectedFormat,
  profileShortLabel,
  currentSampleLabel,
  onViewModeChange,
}: AppHeroProps) {
  return (
    <>
      <div className="hero">
        <div>
          <div className="brand-row">
            <img className="brand-logo" src={paktLogo} alt="PAKT logo" />
            <div className="brand-copy">
              <p className="eyebrow">ClipForge PAKT Playground</p>
              <p className="maker-note">
                Built by Srinivas Pendela. Local browser lab for structured prompt testing.
              </p>
            </div>
          </div>
          <h1>See when structure actually compresses.</h1>
          <p className="lede">
            Try raw JSON, YAML, CSV, and mixed markdown in a local browser playground, compare
            actual PAKT profiles, and verify round-trips before you ship prompts or workflow
            payloads.
          </p>
        </div>
        <div className="hero-card">
          <div className="hero-meta">
            <span>Version</span>
            <strong>{__PAKT_VERSION__}</strong>
          </div>
          <div className="hero-meta">
            <span>Detected input</span>
            <strong>{detectedFormat}</strong>
          </div>
          <div className="hero-meta">
            <span>Current profile</span>
            <strong>{profileShortLabel}</strong>
          </div>
          <div className="hero-meta">
            <span>Current sample</span>
            <strong>{currentSampleLabel}</strong>
          </div>
        </div>
      </div>

      <fieldset className="view-tabs">
        <legend className="sr-only">Playground views</legend>
        <button
          className={`tab-button ${viewMode === 'playground' ? 'active' : ''}`}
          type="button"
          aria-pressed={viewMode === 'playground'}
          onClick={() => onViewModeChange('playground')}
        >
          Playground
        </button>
        <button
          className={`tab-button ${viewMode === 'compare' ? 'active' : ''}`}
          type="button"
          aria-pressed={viewMode === 'compare'}
          onClick={() => onViewModeChange('compare')}
        >
          Compare Layers
        </button>
      </fieldset>
    </>
  );
}
