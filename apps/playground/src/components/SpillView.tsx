/**
 * Bash Spill view: what `pakt hook post-tool-use` would hand the model for a
 * long command output. Runs the same `spill()` as the hook, in the worker,
 * with the hook's defaults (1000-token threshold, 15 head + 15 tail lines).
 *
 * Self-contained: owns its own state; App only mounts it for the `spill` tab.
 * The real hook also leaves error output under the threshold alone and skips
 * output Claude Code already cut; this page shows the gist itself.
 */

import { useState } from 'react';
import { type SpillPreviewResult, spillPreview } from '../pakt-runtime';
import { SPILL_SAMPLE } from '../spill-samples';

const DEFAULTS = { thresholdTokens: 1000, headLines: 15, tailLines: 15 } as const;

function NumberField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="inline-control">
      {props.label}
      <input
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) props.onChange(Math.min(props.max, Math.max(props.min, n)));
        }}
      />
    </label>
  );
}

export function SpillView() {
  const [text, setText] = useState(SPILL_SAMPLE);
  const [thresholdTokens, setThreshold] = useState<number>(DEFAULTS.thresholdTokens);
  const [headLines, setHead] = useState<number>(DEFAULTS.headLines);
  const [tailLines, setTail] = useState<number>(DEFAULTS.tailLines);
  const [result, setResult] = useState<SpillPreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setResult(await spillPreview(text, { thresholdTokens, headLines, tailLines }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Spill preview failed');
    } finally {
      setLoading(false);
    }
  }

  const saved = result?.spilled ? result.originalTokens - result.tokens : 0;

  return (
    <>
      <section className="card spill-card">
        <div className="panel-header">
          <div>
            <p className="panel-label">Bash Spill</p>
            <strong>What the model sees for a long command output</strong>
          </div>
          <span className="meta-badge">{text.split('\n').length} lines</span>
        </div>
        <p className="sample-note">
          Over the threshold, <code>pakt hook post-tool-use</code> keeps the first and last lines
          plus a <code>pakt_recall</code> id; the full text stays on your machine in{' '}
          <code>~/.pakt/spill</code>. The default mode is <code>shadow</code> (log only); set{' '}
          <code>PAKT_SPILL_MODE=live</code> to rewrite outputs. Nothing here leaves the browser.
        </p>

        <textarea
          aria-label="Command output"
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
        />

        <div className="packer-config-row">
          <NumberField
            label="Threshold (tokens)"
            value={thresholdTokens}
            min={200}
            max={50000}
            onChange={setThreshold}
          />
          <NumberField label="Head lines" value={headLines} min={0} max={200} onChange={setHead} />
          <NumberField label="Tail lines" value={tailLines} min={0} max={200} onChange={setTail} />
        </div>

        <div className="action-row">
          <button
            type="button"
            className="primary"
            onClick={() => void run()}
            disabled={loading || !text.trim()}
          >
            {loading ? 'Spilling…' : 'Preview spill'}
          </button>
        </div>
      </section>

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      {result ? (
        <section className="card spill-card">
          <div className="panel-header">
            <div>
              <p className="panel-label">What the model sees</p>
              <strong data-testid="spill-summary">
                {result.spilled
                  ? `Spilled as ${result.id}: ${result.originalTokens} → ${result.tokens} tokens (${saved} saved, ${Math.round((saved / result.originalTokens) * 100)}%).`
                  : `Not spilled: ${result.originalTokens} tokens is under the threshold (or the gist would not be smaller), so the model sees it whole.`}
              </strong>
            </div>
          </div>
          <pre className="workflow-code" aria-label="What the model sees">
            {result.content}
          </pre>
        </section>
      ) : null}
    </>
  );
}
