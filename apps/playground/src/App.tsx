import type { PaktFormat } from '@sriinnu/pakt';
import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import paktLogo from '../../../assets/pakt-logo.svg';
import {
  type ComparisonState,
  analyzePreview,
  compressSource,
  computeComparison,
  decompressSource,
  preloadPaktRuntime,
} from './pakt-runtime';
import { samples } from './samples';

const DECOMPRESS_FORMATS: PaktFormat[] = ['json', 'yaml', 'csv', 'markdown', 'text'];
const RELEASE_NOTES = [
  {
    title: 'Mixed content',
    body: 'Embedded structured blocks restore semantically, but exact original formatting may normalize.',
  },
  {
    title: 'CSV caveat',
    body: 'CSV is not always a win. Some already-compact CSV payloads can get larger.',
  },
  {
    title: 'Privacy',
    body: 'The playground runs locally in your browser session. It does not upload payloads anywhere.',
  },
  {
    title: 'Mixed decompress',
    body: 'To unPAKT mixed content, paste the PAKT-marked output back into Input, then run Decompress.',
  },
] as const;

type Action = 'compress' | 'decompress' | null;
type ViewMode = 'playground' | 'compare';

function formatDelta(before: number, after: number): string {
  const delta = before - after;
  if (delta === 0) return 'No token change';
  const label = delta > 0 ? 'saved' : 'expanded';
  return `${Math.abs(delta).toLocaleString()} tokens ${label}`;
}

function formatPercent(before: number, after: number): string {
  if (before <= 0) return '0%';
  const percent = Math.round(((before - after) / before) * 100);
  return `${percent}%`;
}

function getStatsTone(
  hasOutput: boolean,
  before: number,
  after: number,
): 'idle' | 'saving' | 'expanded' {
  if (!hasOutput) return 'idle';
  return after <= before ? 'saving' : 'expanded';
}

function getOutputLabel(
  lastAction: Action,
  liveCompress: boolean,
  packedInputDetected: boolean,
): string {
  if (liveCompress && packedInputDetected) return 'Ready to restore';
  if (liveCompress && lastAction === 'compress') return 'Live PAKT output';
  if (!lastAction) return 'Output preview';
  return lastAction === 'compress' ? 'PAKT output' : 'Restored output';
}

function getActionSummary(
  lastAction: Action,
  liveCompress: boolean,
  packedInputDetected: boolean,
): { title: string; body: string } {
  if (liveCompress && packedInputDetected) {
    return {
      title: 'PAKT detected',
      body: 'Input already looks packed, so live preview is paused. Use Restore from PAKT to expand it.',
    };
  }

  if (liveCompress && lastAction === 'compress') {
    return {
      title: 'Live compression',
      body: 'Typing recomputes the compact form immediately so you can see whether a payload is actually a win.',
    };
  }

  if (lastAction === 'compress') {
    return {
      title: 'Compression path',
      body: 'Best results show up on repeated keys, tabular payloads, and embedded structured blocks.',
    };
  }

  if (lastAction === 'decompress') {
    return {
      title: 'Round-trip path',
      body: 'Use this to verify that the compact form expands back into the target format you expect.',
    };
  }

  return {
    title: 'Ready to test',
    body: 'Pick a sample or paste your own payload.',
  };
}

export default function App() {
  const initialSample = samples[0];
  const [viewMode, setViewMode] = useState<ViewMode>('playground');
  const [selectedSample, setSelectedSample] = useState(initialSample?.id ?? '');
  const [input, setInput] = useState(initialSample?.text ?? '');
  const [detectedFormat, setDetectedFormat] = useState<PaktFormat>(initialSample?.format ?? 'json');
  const [inputTokens, setInputTokens] = useState(0);
  const [output, setOutput] = useState('');
  const [outputTokens, setOutputTokens] = useState(0);
  const [packedInputDetected, setPackedInputDetected] = useState(false);
  const [decompressTo, setDecompressTo] = useState<PaktFormat>('json');
  const [liveCompress, setLiveCompress] = useState(true);
  const [lastAction, setLastAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const [comparisonState, setComparisonState] = useState<ComparisonState>({
    status: 'idle',
    items: null,
    error: null,
  });
  const suppressPreviewOnceRef = useRef(false);
  const deferredInput = useDeferredValue(input);

  const statsTone = getStatsTone(output.length > 0, inputTokens, outputTokens);
  const actionSummary = getActionSummary(lastAction, liveCompress, packedInputDetected);
  const outputLabel = getOutputLabel(lastAction, liveCompress, packedInputDetected);
  const livePreviewEnabled = liveCompress && !packedInputDetected;
  const compareModeActive = viewMode === 'compare';
  const currentYear = new Date().getFullYear();
  const compressButtonLabel = livePreviewEnabled
    ? 'Live preview running'
    : packedInputDetected
      ? 'Input already packed'
      : 'Preview PAKT';
  const compressButtonDisabled = !input.trim() || packedInputDetected || livePreviewEnabled;
  const actionHint = packedInputDetected
    ? 'Input already looks like PAKT. Restore it from the current Input payload using the format selector.'
    : livePreviewEnabled
      ? 'Live preview is on. Typing recomputes the compact PAKT output immediately.'
      : 'Manual mode is on. Preview PAKT runs on the current Input payload, and Restore from PAKT expects packed text in Input.';
  const currentSample = samples.find((sample) => sample.id === selectedSample);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void preloadPaktRuntime().catch(() => {
        // Warm-up is best-effort; explicit actions surface worker failures.
      });
    }, 150);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(
      async () => {
        const next = await analyzePreview(deferredInput, liveCompress);
        if (cancelled) return;

        startTransition(() => {
          setDetectedFormat(next.detectedFormat);
          setInputTokens(next.inputTokens);
          setPackedInputDetected(next.packedInputDetected);

          if (suppressPreviewOnceRef.current) {
            suppressPreviewOnceRef.current = false;
            return;
          }

          setOutput(next.output);
          setOutputTokens(next.outputTokens);
          setLastAction(next.lastAction);
          setError(next.error);
        });
      },
      liveCompress ? 120 : 0,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [deferredInput, liveCompress]);

  useEffect(() => {
    if (!compareModeActive || !deferredInput.trim() || packedInputDetected) {
      startTransition(() => {
        setComparisonState({
          status: 'idle',
          items: null,
          error: null,
        });
      });
      return;
    }

    let cancelled = false;
    startTransition(() => {
      setComparisonState({
        status: 'loading',
        items: null,
        error: null,
      });
    });

    const timeoutId = window.setTimeout(async () => {
      const next = await computeComparison(deferredInput);
      if (cancelled) return;

      startTransition(() => {
        setComparisonState(next);
      });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [compareModeActive, deferredInput, packedInputDetected]);

  function loadSample(id: string): void {
    const next = samples.find((sample) => sample.id === id);
    if (!next) return;
    setSelectedSample(id);
    setInput(next.text);
    setDetectedFormat(next.format);
    setInputTokens(0);
    setPackedInputDetected(false);
    setOutput('');
    setOutputTokens(0);
    setError(null);
    setLastAction(null);
  }

  function handleInputChange(nextValue: string): void {
    if (currentSample && nextValue !== currentSample.text) {
      setSelectedSample('');
    }
    setInput(nextValue);
  }

  async function handleCompress(): Promise<void> {
    if (!input.trim()) return;
    if (packedInputDetected) {
      setError('Input already looks like PAKT. Use Restore from PAKT instead.');
      return;
    }

    try {
      const next = await compressSource(input);
      setDetectedFormat(next.detectedFormat);
      setInputTokens(next.inputTokens);
      setPackedInputDetected(next.packedInputDetected);
      setOutput(next.output);
      setOutputTokens(next.outputTokens);
      setLastAction('compress');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compression failed');
    }
  }

  async function handleDecompress(): Promise<void> {
    if (!input.trim()) return;

    try {
      const next = await decompressSource(input, decompressTo);
      setDetectedFormat(next.detectedFormat);
      setInputTokens(next.inputTokens);
      setPackedInputDetected(next.packedInputDetected);
      setOutput(next.output);
      setOutputTokens(next.outputTokens);
      setLastAction('decompress');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decompression failed');
    }
  }

  async function handleCopy(): Promise<void> {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setError(null);
    } catch {
      setError('Clipboard copy failed in this browser context');
    }
  }

  function handleSwap(): void {
    if (!output) return;

    suppressPreviewOnceRef.current = true;
    setSelectedSample('');
    setInput(output);
    setInputTokens(outputTokens);
    setPackedInputDetected(lastAction === 'compress');
    setDetectedFormat(lastAction === 'compress' ? 'pakt' : decompressTo);
    setOutput(input);
    setOutputTokens(inputTokens);
    setError(null);
  }

  return (
    <div className="shell">
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
            Try raw JSON, YAML, CSV, and mixed markdown in a local browser playground, watch live
            PAKT output, and verify round-trips before you ship prompts or workflow payloads.
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
            <span>Current sample</span>
            <strong>{currentSample?.label ?? 'Custom'}</strong>
          </div>
        </div>
      </div>

      <fieldset className="view-tabs">
        <legend className="sr-only">Playground views</legend>
        <button
          className={`tab-button ${viewMode === 'playground' ? 'active' : ''}`}
          type="button"
          aria-pressed={viewMode === 'playground'}
          onClick={() => setViewMode('playground')}
        >
          Playground
        </button>
        <button
          className={`tab-button ${viewMode === 'compare' ? 'active' : ''}`}
          type="button"
          aria-pressed={viewMode === 'compare'}
          onClick={() => setViewMode('compare')}
        >
          Compare Layers
        </button>
      </fieldset>

      <div className="controls card">
        <label>
          Sample payload
          <select value={selectedSample} onChange={(event) => loadSample(event.target.value)}>
            <option value="">Custom payload</option>
            {samples.map((sample) => (
              <option key={sample.id} value={sample.id}>
                {sample.label}
              </option>
            ))}
          </select>
        </label>
        <p className="sample-note">{currentSample?.note ?? 'Editing a custom payload.'}</p>
      </div>

      <section className="card notes-card">
        <div className="notes-header">
          <p className="panel-label">Release Notes</p>
          <strong>What to keep in mind while testing</strong>
        </div>
        <div className="notes-grid">
          {RELEASE_NOTES.map((note) => (
            <article key={note.title} className="note-chip">
              <strong>{note.title}</strong>
              <p>{note.body}</p>
            </article>
          ))}
        </div>
      </section>

      {viewMode === 'playground' ? (
        <>
          <div className="workspace">
            <section className="card panel">
              <div className="panel-header">
                <div>
                  <p id="source-panel-label" className="panel-label">
                    Source input
                  </p>
                  <strong id="source-panel-status">{detectedFormat}</strong>
                </div>
                <span>{inputTokens.toLocaleString()} tokens</span>
              </div>
              <textarea
                id="source-input"
                aria-labelledby="source-panel-label source-panel-status"
                value={input}
                onChange={(event) => handleInputChange(event.target.value)}
                spellCheck={false}
                placeholder="Paste JSON, YAML, CSV, or markdown with embedded data blocks"
              />
              <div className="action-row">
                <label className="toggle-control" htmlFor="live-compress-toggle">
                  <input
                    id="live-compress-toggle"
                    type="checkbox"
                    checked={liveCompress}
                    onChange={(event) => setLiveCompress(event.target.checked)}
                  />
                  <span>Live PAKT preview</span>
                </label>
                <button
                  className="primary"
                  type="button"
                  onClick={handleCompress}
                  disabled={compressButtonDisabled}
                >
                  {compressButtonLabel}
                </button>
                <button className="secondary" type="button" onClick={handleDecompress}>
                  Restore from PAKT
                </button>
                <label className="inline-control">
                  restore as
                  <select
                    value={decompressTo}
                    onChange={(event) => setDecompressTo(event.target.value as PaktFormat)}
                  >
                    {DECOMPRESS_FORMATS.map((format) => (
                      <option key={format} value={format}>
                        {format}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="action-note">{actionHint}</p>
            </section>

            <section className="card panel accent-panel">
              <div className="panel-header">
                <div>
                  <p id="output-panel-label" className="panel-label">
                    Output
                  </p>
                  <strong id="output-panel-status">{outputLabel}</strong>
                </div>
                <span>{output ? `${outputTokens.toLocaleString()} tokens` : 'Run an action'}</span>
              </div>
              <textarea
                id="output-text"
                aria-labelledby="output-panel-label output-panel-status"
                value={output}
                readOnly
                spellCheck={false}
                placeholder={
                  packedInputDetected
                    ? 'PAKT detected in Input. Click Restore from PAKT to expand it.'
                    : 'Output appears here'
                }
              />
              <div className="action-row compact">
                <button className="ghost" type="button" onClick={handleSwap} disabled={!output}>
                  Swap input/output
                </button>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => {
                    setOutput('');
                    setOutputTokens(0);
                  }}
                  disabled={!output}
                >
                  Clear output
                </button>
                <button className="ghost" type="button" onClick={handleCopy} disabled={!output}>
                  Copy output
                </button>
              </div>
            </section>
          </div>

          <div className="stats-grid">
            <article className="card stat-card">
              <span className="stat-label">Token delta</span>
              <strong>{output ? formatDelta(inputTokens, outputTokens) : 'Awaiting result'}</strong>
              <p>
                {output
                  ? `${formatPercent(inputTokens, outputTokens)} vs input`
                  : 'Compress or decompress to compare.'}
              </p>
            </article>
            <article className={`card stat-card tone-${statsTone}`}>
              <span className="stat-label">What this shows</span>
              <strong>{actionSummary.title}</strong>
              <p>{actionSummary.body}</p>
            </article>
          </div>
        </>
      ) : (
        <section className="compare-shell">
          <div className="compare-header">
            <div>
              <p className="panel-label">Layer Comparison</p>
              <strong>Original vs structural rewrite vs full PAKT</strong>
            </div>
            <span className="compare-caption">
              Structural baseline is the closest apples-to-apples proxy for TOON-style compact
              syntax.
            </span>
          </div>
          {packedInputDetected ? (
            <div className="card compare-empty">
              <strong>Restore the payload first</strong>
              <p>Comparison mode expects a raw source document, not already-packed PAKT output.</p>
            </div>
          ) : comparisonState.items ? (
            <div className="compare-grid">
              {comparisonState.items.map((item) => (
                <article key={item.id} className="card compare-card">
                  <div className="compare-card-head">
                    <div>
                      <p className="panel-label">{item.label}</p>
                      <strong>{item.tokens.toLocaleString()} tokens</strong>
                    </div>
                    <span className="compare-pill">{item.percent}</span>
                  </div>
                  <p className="compare-delta">{item.delta}</p>
                  <p className="compare-note">{item.note}</p>
                  <pre className="compare-preview">{item.text}</pre>
                </article>
              ))}
            </div>
          ) : comparisonState.status === 'loading' ? (
            <div className="card compare-empty">
              <strong>Calculating comparison</strong>
              <p>
                Large payloads are debounced so typing stays responsive while layers recalculate.
              </p>
            </div>
          ) : (
            <div className="card compare-empty">
              <strong>
                {comparisonState.error ? 'Comparison unavailable' : 'Paste a payload to compare'}
              </strong>
              <p>
                {comparisonState.error ??
                  'Use JSON, YAML, CSV, or mixed markdown to see how each layer behaves.'}
              </p>
            </div>
          )}
        </section>
      )}

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      <footer className="footer">
        <span>PAKT v{__PAKT_VERSION__}</span>
        <span>&copy; {currentYear} Srinivas Pendela</span>
        <span>Local browser playground for structured payload testing</span>
      </footer>
    </div>
  );
}
