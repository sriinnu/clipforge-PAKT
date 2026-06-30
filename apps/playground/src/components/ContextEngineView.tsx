/**
 * Context Engine view — runs the agent-loop optimizer (`createContextEngine`)
 * over a demo conversation and surfaces the per-layer savings the single-payload
 * compressor cannot show: cross-message `@shared` dictionary, extractive
 * selection, code compaction, dedup, and tool-result aging.
 *
 * Self-contained: owns its own state and calls the worker via
 * {@link optimizeContext}; App only mounts it for the `context` tab.
 */

import { useState } from 'react';
import { CONTEXT_SAMPLES } from '../context-samples';
import { type ContextOptimizeResult, optimizeContext } from '../pakt-runtime';

/** Friendly labels for the `savings.breakdown` keys. */
const BREAKDOWN_LABELS: Record<string, string> = {
  toolResults: 'Tool-result compression',
  historyCompression: 'History compression',
  summarization: 'Summarization',
  deduplication: 'Deduplication',
  toolResultAging: 'Tool-result aging',
  sharedDictionary: 'Cross-message @shared dictionary',
  extractive: 'Extractive selection (lossy)',
  codeCompaction: 'Code compaction (lossy)',
};

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

export function ContextEngineView() {
  const [sampleId, setSampleId] = useState<string>(CONTEXT_SAMPLES[0]?.id ?? '');
  const sample = CONTEXT_SAMPLES.find((s) => s.id === sampleId) ?? CONTEXT_SAMPLES[0];

  const [sharedDictionary, setSharedDictionary] = useState(true);
  const [extractive, setExtractive] = useState(false);
  const [query, setQuery] = useState(sample?.suggestedQuery ?? '');
  const [compactCode, setCompactCode] = useState(false);

  const [result, setResult] = useState<ContextOptimizeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onSampleChange(id: string): void {
    setSampleId(id);
    const next = CONTEXT_SAMPLES.find((s) => s.id === id);
    setQuery(next?.suggestedQuery ?? '');
    setResult(null);
    setError(null);
  }

  async function runOptimize(): Promise<void> {
    if (!sample) return;
    setLoading(true);
    setError(null);
    try {
      const next = await optimizeContext(sample.messages, {
        sharedDictionary,
        extractive,
        ...(extractive && query.trim() ? { query: query.trim() } : {}),
        compactCode,
        recentTurns: 2,
      });
      setResult(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed');
    } finally {
      setLoading(false);
    }
  }

  const breakdownRows = result ? Object.entries(result.breakdown).filter(([, v]) => v > 0) : [];

  return (
    <section className="card workspace">
      <div className="panel-header">
        <span className="panel-label">Context Engine — agent-loop optimizer</span>
        <span className="meta-badge">{sample?.messages.length ?? 0} messages</span>
      </div>

      <p className="sample-note">
        Runs <code>createContextEngine().optimize()</code> over a demo conversation. Lossless layers
        (cross-message <code>@shared</code> dictionary, dedup, aging) are on by default; the lossy
        ones are opt-in. The same engine ships in <code>@sriinnu/pakt</code> for real agent loops.
      </p>

      <div className="action-row">
        <label className="inline-control">
          Sample
          <select value={sampleId} onChange={(e) => onSampleChange(e.target.value)}>
            {CONTEXT_SAMPLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {sample ? <p className="sample-note">{sample.description}</p> : null}

      <div className="stats-grid">
        <label className="toggle-control">
          <input
            type="checkbox"
            checked={sharedDictionary}
            onChange={(e) => setSharedDictionary(e.target.checked)}
          />
          Cross-message @shared dictionary (lossless)
        </label>
        <label className="toggle-control">
          <input
            type="checkbox"
            checked={compactCode}
            onChange={(e) => setCompactCode(e.target.checked)}
          />
          Code compaction (lossy — strips comments)
        </label>
        <label className="toggle-control">
          <input
            type="checkbox"
            checked={extractive}
            onChange={(e) => setExtractive(e.target.checked)}
          />
          Extractive selection (lossy — keeps query-relevant lines)
        </label>
        {extractive ? (
          <label className="inline-control">
            Query
            <input
              type="text"
              value={query}
              placeholder="what to keep…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        ) : null}
      </div>

      <div className="action-row">
        <button
          type="button"
          className="primary"
          onClick={() => void runOptimize()}
          disabled={loading}
        >
          {loading ? 'Optimizing…' : 'Optimize context'}
        </button>
      </div>

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      {result ? (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">Before</span>
              <strong>{result.originalTokens.toLocaleString()} tok</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">After</span>
              <strong>{result.optimizedTokens.toLocaleString()} tok</strong>
            </div>
            <div className={`stat-card ${result.savedTokens > 0 ? 'tone-expanded' : 'tone-idle'}`}>
              <span className="stat-label">Saved</span>
              <strong>
                {result.savedTokens.toLocaleString()} tok ({pct(result.savedPercent)})
              </strong>
            </div>
          </div>

          <div className="panel-header">
            <span className="panel-label">Savings by layer</span>
          </div>
          {breakdownRows.length > 0 ? (
            <div className="stats-grid">
              {breakdownRows.map(([key, value]) => (
                <div className="stat-card" key={key}>
                  <span className="stat-label">{BREAKDOWN_LABELS[key] ?? key}</span>
                  <strong>{value.toLocaleString()} tok</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="sample-note">
              No layer saved tokens for this configuration — try a different sample or enable a
              layer.
            </p>
          )}

          <div className="panel-header">
            <span className="panel-label">Optimized messages</span>
            <span className="meta-badge">{result.messages.length} sent</span>
          </div>
          <div className="workspace">
            {result.messages.map((m, i) => (
              <div className="panel" key={`${m.role}-${i}`}>
                <div className="panel-header">
                  <span className="meta-badge">
                    {m.toolName ? `${m.role}:${m.toolName}` : m.role}
                  </span>
                  <span className="stat-label">{m.tokens.toLocaleString()} tok</span>
                </div>
                <pre className="workflow-code">
                  {m.content.length > 600
                    ? `${m.content.slice(0, 600)}\n… (${m.content.length - 600} more chars)`
                    : m.content}
                </pre>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
