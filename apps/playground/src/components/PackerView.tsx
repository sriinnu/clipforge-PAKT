/**
 * Context Window Packer view — demonstrates `pack()` fitting multiple documents
 * into a token budget with priority-based ordering and adaptive compression.
 *
 * Self-contained: owns its own state and calls the worker via {@link runPacker}.
 * App only mounts it for the `packer` tab.
 */

import { useState } from 'react';
import { TARGET_MODELS } from '../app-constants';
import { type PackerRunResult, runPacker } from '../pakt-runtime';
import { DEFAULT_PACKER_ITEMS, type PackerSample, toPackerRunItems } from '../packer-samples';

const PRIORITY_LABELS: Record<number, string> = { 10: 'High', 8: 'Medium-high', 6: 'Medium', 4: 'Low' };
const PRIORITY_OPTIONS = [
  { value: 10, label: 'High (10)' },
  { value: 8, label: 'Medium-high (8)' },
  { value: 6, label: 'Medium (6)' },
  { value: 4, label: 'Low (4)' },
];

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

function utilizationTone(used: number, budget: number): string {
  const ratio = used / budget;
  if (ratio >= 0.9) return 'tone-saving';
  if (ratio >= 0.6) return 'tone-idle';
  return '';
}

export function PackerView() {
  const [items, setItems] = useState<PackerSample[]>(() => [...DEFAULT_PACKER_ITEMS]);
  const [budget, setBudget] = useState(2048);
  const [model, setModel] = useState(TARGET_MODELS[0]?.id ?? 'gpt-4o');
  const [result, setResult] = useState<PackerRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updatePriority(id: string, priority: number): void {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, priority } : item)));
    setResult(null);
  }

  async function handlePack(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const next = await runPacker(toPackerRunItems(items), budget, model);
      setResult(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Packer failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="card">
        <div className="panel-header">
          <div>
            <p className="panel-label">Context Window Packer</p>
            <strong>Fit N documents into a token budget</strong>
          </div>
        </div>
        <p className="sample-note">
          {`pack() compresses each item with PAKT, respects priority ordering, and drops what
          doesn't fit. Adaptive compression applies heavier profiles to lower-priority items as
          the budget runs low.`}
        </p>

        <div className="packer-config-row">
          <label className="inline-control">
            Token budget
            <input
              type="number"
              min={256}
              max={128000}
              step={256}
              value={budget}
              onChange={(e) => {
                setBudget(Math.max(256, Number(e.target.value)));
                setResult(null);
              }}
            />
          </label>
          <label className="inline-control">
            Model
            <select value={model} onChange={(e) => { setModel(e.target.value); setResult(null); }}>
              {TARGET_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="packer-items">
          {items.map((item) => (
            <div key={item.id} className="packer-item card">
              <div className="packer-item-header">
                <span className="packer-item-label">{item.label}</span>
                <span className="meta-badge">{item.role}</span>
                <label className="inline-control">
                  priority
                  <select
                    value={item.priority}
                    onChange={(e) => updatePriority(item.id, Number(e.target.value))}
                  >
                    {PRIORITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <pre className="packer-item-preview">{item.content.slice(0, 200)}{item.content.length > 200 ? '…' : ''}</pre>
            </div>
          ))}
        </div>

        <div className="action-row">
          <button
            className="primary"
            type="button"
            onClick={() => void handlePack()}
            disabled={loading}
          >
            {loading ? 'Packing…' : `Pack ${items.length} documents into ${budget.toLocaleString()} tokens`}
          </button>
        </div>
      </section>

      {error ? <div className="error-banner" role="alert">{error}</div> : null}

      {result ? (
        <>
          <div className="stats-grid">
            <article className={`card stat-card ${utilizationTone(result.totalTokens, budget)}`}>
              <span className="stat-label">Budget used</span>
              <strong>{result.totalTokens.toLocaleString()} / {budget.toLocaleString()} tokens</strong>
              <p>{pct(result.totalTokens / budget * 100)} utilization · {result.remainingBudget.toLocaleString()} remaining</p>
            </article>
            <article className="card stat-card tone-saving">
              <span className="stat-label">Compression savings</span>
              <strong>{pct(result.stats.overallSavingsPercent)} saved</strong>
              <p>{result.stats.originalTotalTokens.toLocaleString()} → {result.stats.compressedTotalTokens.toLocaleString()} tokens across packed items</p>
            </article>
            <article className="card stat-card">
              <span className="stat-label">Items packed / dropped</span>
              <strong>{result.stats.packedCount} packed · {result.stats.droppedCount} dropped</strong>
              <p>
                {result.stats.droppedCount === 0
                  ? 'All items fit within the budget.'
                  : `${result.stats.droppedCount} item${result.stats.droppedCount === 1 ? '' : 's'} dropped — lower the budget to see adaptive cut-off.`}
              </p>
            </article>
          </div>

          <section className="card">
            <div className="panel-header">
              <p className="panel-label">Packed items</p>
              <span>{result.packed.length} items · in priority order</span>
            </div>
            {result.packed.map((p) => {
              const orig = items.find((i) => i.id === p.id);
              return (
                <div key={p.id} className="packer-result-item">
                  <div className="packer-result-header">
                    <strong>{orig?.label ?? p.id}</strong>
                    <span className="meta-badge">{PRIORITY_LABELS[orig?.priority ?? 0] ?? String(orig?.priority)}</span>
                    {p.wasCompressed
                      ? <span className="meta-badge tone-saving">{pct(p.savingsPercent)} saved · {p.compressedTokens} tok</span>
                      : <span className="meta-badge">kept raw · {p.compressedTokens} tok</span>}
                  </div>
                  <pre className="workflow-code packer-compressed">{p.compressed.slice(0, 400)}{p.compressed.length > 400 ? '\n…' : ''}</pre>
                </div>
              );
            })}
          </section>

          {result.dropped.length > 0 ? (
            <section className="card">
              <div className="panel-header">
                <p className="panel-label">Dropped items</p>
                <span>{result.dropped.length} items · over budget</span>
              </div>
              {result.dropped.map((d) => {
                const orig = items.find((i) => i.id === d.id);
                return (
                  <div key={d.id} className="packer-result-item packer-dropped">
                    <div className="packer-result-header">
                      <strong>{orig?.label ?? d.id}</strong>
                      <span className="meta-badge">{PRIORITY_LABELS[orig?.priority ?? 0] ?? String(orig?.priority)}</span>
                      <span className="meta-badge recommendation-warning">
                        {d.reason === 'over_budget' ? 'over budget' : d.reason} · needed {d.tokensNeeded} tok
                      </span>
                    </div>
                  </div>
                );
              })}
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}
