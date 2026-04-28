/**
 * "Compare Layers" view: recommendation card, comparison grid, and the
 * empty / loading / error fallbacks. Stateless render driven by the
 * already-resolved {@link ComparisonState} from the parent.
 */

import { getResultBadges } from '../app-helpers';
import type { ComparisonState } from '../pakt-runtime';

/**
 * Props for {@link CompareLayersView}.
 *
 * `tableProjectionWinner` is computed by the parent because it depends
 * on a string-id check against `comparisonState.recommendation` and is
 * also used to swap two pieces of copy (recommendation note + button
 * label).
 */
export interface CompareLayersViewProps {
  /** Resolved comparison state from the worker. */
  comparisonState: ComparisonState;
  /** `true` when the input has already been packed; suppresses comparison. */
  packedInputDetected: boolean;
  /** Whether the recommended winner is one of the layout-projection variants. */
  tableProjectionWinner: boolean;
  /** Click handler for the "Use winner in Playground" button. */
  onApplyWinner: () => void;
}

/**
 * Render the entire `viewMode === 'compare'` panel — header strip, the
 * recommendation card (when present), and the per-profile comparison
 * grid (or one of the three empty states).
 */
export function CompareLayersView({
  comparisonState,
  packedInputDetected,
  tableProjectionWinner,
  onApplyWinner,
}: CompareLayersViewProps) {
  return (
    <section className="compare-shell">
      <CompareHeader />
      <CompareBody
        comparisonState={comparisonState}
        packedInputDetected={packedInputDetected}
        tableProjectionWinner={tableProjectionWinner}
        onApplyWinner={onApplyWinner}
      />
    </section>
  );
}

/* Static title strip shown above any of the comparison body variants. */
function CompareHeader() {
  return (
    <div className="compare-header">
      <div>
        <p className="panel-label">Layer Comparison</p>
        <strong>Original vs real PAKT profiles vs table-aware candidates</strong>
      </div>
      <span className="compare-caption">
        Compare Layers benchmarks structure-only, standard, tokenizer-aware, and semantic profiles
        when a budget is set, then recommends the smallest output.
      </span>
    </div>
  );
}

/* Pick the right body for the current state — packed-input warning,
   results, loading, or empty fallback. */
function CompareBody({
  comparisonState,
  packedInputDetected,
  tableProjectionWinner,
  onApplyWinner,
}: CompareLayersViewProps) {
  if (packedInputDetected) {
    return (
      <div className="card compare-empty">
        <strong>Restore the payload first</strong>
        <p>Comparison mode expects a raw source document, not already-packed PAKT output.</p>
      </div>
    );
  }

  if (comparisonState.items) {
    return (
      <>
        {comparisonState.recommendation ? (
          <RecommendationCard
            recommendation={comparisonState.recommendation}
            tableProjectionWinner={tableProjectionWinner}
            onApplyWinner={onApplyWinner}
          />
        ) : null}
        <div className="compare-grid">
          {comparisonState.items.map((item) => (
            <CompareCard key={item.id} item={item} />
          ))}
        </div>
      </>
    );
  }

  if (comparisonState.status === 'loading') {
    return (
      <div className="card compare-empty">
        <strong>Calculating comparison</strong>
        <p>Large payloads are debounced so typing stays responsive while layers recalculate.</p>
      </div>
    );
  }

  return (
    <div className="card compare-empty">
      <strong>
        {comparisonState.error ? 'Comparison unavailable' : 'Paste a payload to compare'}
      </strong>
      <p>
        {comparisonState.error ??
          'Use JSON, YAML, CSV, or mixed markdown to see how each layer behaves.'}
      </p>
    </div>
  );
}

/* The auto-pack recommendation card shown above the per-profile grid. */
function RecommendationCard({
  recommendation,
  tableProjectionWinner,
  onApplyWinner,
}: {
  recommendation: NonNullable<ComparisonState['recommendation']>;
  tableProjectionWinner: boolean;
  onApplyWinner: () => void;
}) {
  return (
    <article className="card recommendation-card">
      <div>
        <p className="panel-label">Auto-pack recommendation</p>
        <strong>{recommendation.title}</strong>
        <p className="recommendation-copy">{recommendation.body}</p>
      </div>
      <div className="recommendation-meta">
        <span>{recommendation.winnerLabel}</span>
        <strong>{recommendation.tokens.toLocaleString()} tokens</strong>
        {tableProjectionWinner ? (
          <p className="recommendation-warning">
            Projection warning: Restore returns the projected table layout, not the original source
            wrapper.
          </p>
        ) : null}
        {recommendation.packedOutput ? (
          <button className="ghost" type="button" onClick={onApplyWinner}>
            {tableProjectionWinner ? 'Use projection in Playground' : 'Use winner in Playground'}
          </button>
        ) : null}
      </div>
    </article>
  );
}

/* One card in the per-profile comparison grid. */
function CompareCard({ item }: { item: NonNullable<ComparisonState['items']>[number] }) {
  return (
    <article className="card compare-card">
      <div className="compare-card-head">
        <div>
          <p className="panel-label">{item.label}</p>
          <strong>{item.tokens.toLocaleString()} tokens</strong>
        </div>
        <span className="compare-pill">{item.percent}</span>
      </div>
      <div className="compare-badge-row">
        {getResultBadges(item).map((badge) => (
          <span key={badge} className="meta-badge">
            {badge}
          </span>
        ))}
        {/* Delta encoding indicator — shown when compressed output uses delta mode */}
        {item.text.includes('@compress delta') ? (
          <span className="meta-badge delta-badge">Delta</span>
        ) : null}
      </div>
      <p className="compare-delta">{item.delta}</p>
      <p className="compare-note">{item.note}</p>
      <pre className="compare-preview">{item.text}</pre>
    </article>
  );
}
