import {
  DEFAULT_SEMANTIC_BUDGET,
  PAKT_LAYER_PROFILES,
  type PaktFormat,
  type PaktLayerProfileId,
  getPaktLayerProfile,
} from '@sriinnu/pakt';
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import paktLogo from '../../../assets/pakt-logo.svg';
import {
  type ComparisonItem,
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
    title: 'Auto-pack',
    body: 'Compare Layers benchmarks structure-only, standard, tokenizer-aware, and optional semantic PAKT profiles.',
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

const WORKFLOW_SNIPPET_PREVIEW = {
  cli: ['cat payload.txt | pakt inspect', 'cat payload.txt | pakt auto'].join('\n'),
  mcp: JSON.stringify(
    {
      mcpServers: {
        pakt: {
          command: 'npx',
          args: ['-y', '@sriinnu/pakt', 'serve', '--stdio'],
        },
      },
    },
    null,
    2,
  ),
} as const;

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

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function getWorkflowPayload(input: string): string {
  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (normalized.length > 0) {
    return normalized;
  }

  return '{"paste":"structured payload here","tip":"then run pakt inspect first"}';
}

function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function buildCliWorkflowSnippet(input: string): string {
  const payloadBase64 = encodeBase64(getWorkflowPayload(input));
  const decodeCommand = `node --input-type=module -e "process.stdout.write(Buffer.from('${payloadBase64}','base64').toString('utf8'))"`;
  return [`${decodeCommand} | pakt inspect`, `${decodeCommand} | pakt auto`].join('\n');
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
  profileLabel: string,
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
      body: `Typing recomputes ${profileLabel} immediately so you can see whether the current payload is actually a win.`,
    };
  }

  if (lastAction === 'compress') {
    return {
      title: 'Compression path',
      body: `Current profile: ${profileLabel}. Best results show up on repeated keys, tabular payloads, and embedded structured blocks.`,
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

function parseSemanticBudget(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function getResultBadges(item: ComparisonItem): string[] {
  if (item.kind === 'table') {
    return ['Projection changes layout', 'Lossless pack'];
  }

  if (item.profileId) {
    const profile = getPaktLayerProfile(item.profileId);
    return [
      item.reversible === false ? 'Lossy output' : 'Lossless output',
      item.reversible === false ? 'Not fully reversible' : 'Reversible',
      profile.shortLabel,
      ...(profile.id === 'tokenizer' || profile.id === 'semantic' ? ['Model-sensitive'] : []),
    ];
  }

  return ['Source'];
}

export default function App() {
  const initialSample = samples[0];
  const [viewMode, setViewMode] = useState<ViewMode>('playground');
  const [selectedSample, setSelectedSample] = useState(initialSample?.id ?? '');
  const [compressionProfileId, setCompressionProfileId] = useState<PaktLayerProfileId>('standard');
  const [semanticBudgetInput, setSemanticBudgetInput] = useState(String(DEFAULT_SEMANTIC_BUDGET));
  const [input, setInput] = useState(initialSample?.text ?? '');
  const [detectedFormat, setDetectedFormat] = useState<PaktFormat>(initialSample?.format ?? 'json');
  const [inputTokens, setInputTokens] = useState(0);
  const [output, setOutput] = useState('');
  const [outputTokens, setOutputTokens] = useState(0);
  const [packedInputDetected, setPackedInputDetected] = useState(false);
  const [decompressTo, setDecompressTo] = useState<PaktFormat>('json');
  const [liveCompress, setLiveCompress] = useState(true);
  const [lastAction, setLastAction] = useState<Action>(null);
  const [pendingAction, setPendingAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const [comparisonState, setComparisonState] = useState<ComparisonState>({
    status: 'idle',
    items: null,
    error: null,
    recommendation: null,
  });
  const [workflowNotice, setWorkflowNotice] = useState<string | null>(null);
  const suppressPreviewOnceRef = useRef(false);
  const manualRequestIdRef = useRef(0);
  const deferredInput = useDeferredValue(input);

  const selectedProfile = useMemo(
    () => getPaktLayerProfile(compressionProfileId),
    [compressionProfileId],
  );
  const semanticBudget = selectedProfile.requiresSemanticBudget
    ? parseSemanticBudget(semanticBudgetInput)
    : undefined;
  const semanticBudgetValid =
    !selectedProfile.requiresSemanticBudget || semanticBudget !== undefined;
  const compressionConfig = useMemo(
    () => ({
      profileId: compressionProfileId,
      ...(semanticBudget !== undefined ? { semanticBudget } : {}),
    }),
    [compressionProfileId, semanticBudget],
  );

  const statsTone = getStatsTone(output.length > 0, inputTokens, outputTokens);
  const actionSummary = getActionSummary(
    lastAction,
    liveCompress,
    packedInputDetected,
    `${selectedProfile.label} (${selectedProfile.shortLabel})`,
  );
  const outputLabel = getOutputLabel(lastAction, liveCompress, packedInputDetected);
  const tableProjectionWinner =
    comparisonState.recommendation?.winnerId === 'layout-csv' ||
    comparisonState.recommendation?.winnerId === 'layout-json' ||
    comparisonState.recommendation?.winnerId === 'layout-yaml';
  const livePreviewEnabled = liveCompress && !packedInputDetected && semanticBudgetValid;
  const manualActionInFlight = pendingAction !== null;
  const compareModeActive = viewMode === 'compare';
  const currentYear = new Date().getFullYear();
  const compressButtonLabel = !semanticBudgetValid
    ? 'Semantic budget required'
    : livePreviewEnabled
      ? 'Live preview running'
      : pendingAction === 'compress'
        ? 'Compressing...'
        : packedInputDetected
          ? 'Input already packed'
          : 'Preview PAKT';
  const decompressButtonLabel =
    pendingAction === 'decompress' ? 'Restoring...' : 'Restore from PAKT';
  const compressButtonDisabled =
    !input.trim() ||
    packedInputDetected ||
    livePreviewEnabled ||
    manualActionInFlight ||
    !semanticBudgetValid;
  const decompressButtonDisabled = !input.trim() || manualActionInFlight;
  const actionHint = !semanticBudgetValid
    ? 'Semantic profile needs a positive token budget before preview or compression can run.'
    : packedInputDetected
      ? 'Input already looks like PAKT. Restore it from the current Input payload using the format selector.'
      : livePreviewEnabled
        ? `Live preview is on. Typing recomputes ${selectedProfile.shortLabel} immediately.`
        : 'Manual mode is on. Preview PAKT runs on the current Input payload, and Restore from PAKT expects packed text in Input.';
  const currentSample = samples.find((sample) => sample.id === selectedSample);
  const workflowInsightTitle = packedInputDetected
    ? 'Current payload is already packed'
    : output && outputTokens > 0 && outputTokens < inputTokens
      ? `${selectedProfile.label} looks worth using`
      : output && outputTokens > 0 && outputTokens >= inputTokens
        ? `${selectedProfile.label} is near break-even`
        : 'Inspect the payload before you wire it in';
  const workflowInsightBody = packedInputDetected
    ? 'Use Restore from PAKT to verify the round-trip, then hand the same payload into the CLI, MCP server, or extension.'
    : output && outputTokens > 0 && outputTokens < inputTokens
      ? selectedProfile.reversible
        ? 'This is the kind of payload that should graduate from the playground into your CLI, MCP, extension, or desktop workflow.'
        : 'This lossy profile saves tokens here. Keep it for aggressive prompt packing, not exact round-trip guarantees.'
      : output && outputTokens > 0 && outputTokens >= inputTokens
        ? 'This payload is useful for testing, but it is not a strong launch demo. Try a repeated JSON table or mixed markdown sample.'
        : 'Start with Compare Layers or Live PAKT preview, then move the winning payload into the CLI or MCP surface.';

  function invalidatePendingAction(): void {
    manualRequestIdRef.current += 1;
    setPendingAction(null);
  }

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
    if (!semanticBudgetValid) {
      startTransition(() => {
        setOutput('');
        setOutputTokens(0);
        setLastAction(null);
        setError('Semantic profile requires a positive token budget.');
      });
      return;
    }

    if (error === 'Semantic profile requires a positive token budget.') {
      setError(null);
    }
  }, [semanticBudgetValid, error]);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(
      async () => {
        try {
          const next = await analyzePreview(deferredInput, liveCompress, compressionConfig);
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
        } catch (error) {
          if (cancelled) return;

          startTransition(() => {
            suppressPreviewOnceRef.current = false;
            setOutput('');
            setOutputTokens(0);
            setLastAction(null);
            setError(getErrorMessage(error, 'Preview unavailable'));
          });
        }
      },
      liveCompress ? 120 : 0,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [compressionConfig, deferredInput, liveCompress]);

  useEffect(() => {
    if (!compareModeActive || !deferredInput.trim() || packedInputDetected) {
      startTransition(() => {
        setComparisonState({
          status: 'idle',
          items: null,
          error: null,
          recommendation: null,
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
        recommendation: null,
      });
    });

    const timeoutId = window.setTimeout(async () => {
      try {
        const next = await computeComparison(deferredInput, semanticBudget);
        if (cancelled) return;

        startTransition(() => {
          setComparisonState(next);
        });
      } catch (error) {
        if (cancelled) return;

        startTransition(() => {
          setComparisonState({
            status: 'ready',
            items: null,
            error: getErrorMessage(error, 'Comparison unavailable'),
            recommendation: null,
          });
        });
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [compareModeActive, deferredInput, packedInputDetected, semanticBudget]);

  function loadSample(id: string): void {
    invalidatePendingAction();

    if (!id) {
      setSelectedSample('');
      setError(null);
      return;
    }

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
    invalidatePendingAction();
    if (currentSample && nextValue !== currentSample.text) {
      setSelectedSample('');
    }
    setInput(nextValue);
  }

  async function handleCompress(): Promise<void> {
    if (!input.trim() || !semanticBudgetValid) return;
    if (packedInputDetected) {
      setError('Input already looks like PAKT. Use Restore from PAKT instead.');
      return;
    }

    const requestId = manualRequestIdRef.current + 1;
    manualRequestIdRef.current = requestId;
    setPendingAction('compress');
    setError(null);

    try {
      const next = await compressSource(input, compressionConfig);
      if (manualRequestIdRef.current !== requestId) return;

      setDetectedFormat(next.detectedFormat);
      setInputTokens(next.inputTokens);
      setPackedInputDetected(next.packedInputDetected);
      setOutput(next.output);
      setOutputTokens(next.outputTokens);
      setLastAction('compress');
      setError(null);
    } catch (err) {
      if (manualRequestIdRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : 'Compression failed');
    } finally {
      if (manualRequestIdRef.current === requestId) {
        setPendingAction(null);
      }
    }
  }

  async function handleDecompress(): Promise<void> {
    if (!input.trim()) return;

    const requestId = manualRequestIdRef.current + 1;
    manualRequestIdRef.current = requestId;
    setPendingAction('decompress');
    setError(null);

    try {
      const next = await decompressSource(input, decompressTo);
      if (manualRequestIdRef.current !== requestId) return;

      setDetectedFormat(next.detectedFormat);
      setInputTokens(next.inputTokens);
      setPackedInputDetected(next.packedInputDetected);
      setOutput(next.output);
      setOutputTokens(next.outputTokens);
      setLastAction('decompress');
      setError(null);
    } catch (err) {
      if (manualRequestIdRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : 'Decompression failed');
    } finally {
      if (manualRequestIdRef.current === requestId) {
        setPendingAction(null);
      }
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

  async function handleCopyWorkflow(label: 'cli' | 'mcp'): Promise<void> {
    try {
      const text = label === 'cli' ? buildCliWorkflowSnippet(input) : WORKFLOW_SNIPPET_PREVIEW.mcp;
      await navigator.clipboard.writeText(text);
      setWorkflowNotice(`${label.toUpperCase()} snippet copied`);
      window.setTimeout(
        () => setWorkflowNotice((current) => (current?.includes('copied') ? null : current)),
        1800,
      );
    } catch {
      setError('Clipboard copy failed in this browser context');
    }
  }

  function handleSwap(): void {
    if (!output) return;

    invalidatePendingAction();
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

  function handleApplyComparisonWinner(): void {
    const winner = comparisonState.recommendation;
    if (!winner?.packedOutput) return;

    invalidatePendingAction();
    setViewMode('playground');
    setOutput(winner.packedOutput);
    setOutputTokens(winner.tokens);
    setLastAction('compress');
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
            <strong>{selectedProfile.shortLabel}</strong>
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
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '12px',
          }}
        >
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
          <label>
            Compression profile
            <select
              value={compressionProfileId}
              onChange={(event) =>
                setCompressionProfileId(event.target.value as PaktLayerProfileId)
              }
            >
              {PAKT_LAYER_PROFILES.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label} ({profile.shortLabel})
                </option>
              ))}
            </select>
          </label>
          {selectedProfile.requiresSemanticBudget ? (
            <label>
              Semantic budget
              <input
                type="number"
                min={1}
                step={1}
                value={semanticBudgetInput}
                onChange={(event) => setSemanticBudgetInput(event.target.value)}
                style={{
                  borderRadius: '999px',
                  padding: '11px 14px',
                  background: 'var(--panel-strong)',
                  color: 'var(--ink)',
                  border: '1px solid var(--line)',
                }}
              />
            </label>
          ) : null}
        </div>
        <p className="sample-note">{currentSample?.note ?? 'Editing a custom payload.'}</p>
        <p className="sample-note" style={{ marginTop: '-6px', opacity: 0.85 }}>
          {selectedProfile.description}
        </p>
        <div className="profile-badge-row">
          <span className="meta-badge">
            {selectedProfile.requiresSemanticBudget ? 'May become lossy' : 'Lossless profile'}
          </span>
          <span className="meta-badge">
            {selectedProfile.requiresSemanticBudget ? 'Budgeted semantic' : 'Reversible by design'}
          </span>
          <span className="meta-badge">{selectedProfile.shortLabel}</span>
          {selectedProfile.id === 'tokenizer' || selectedProfile.id === 'semantic' ? (
            <span className="meta-badge">Model-sensitive</span>
          ) : null}
        </div>
        {selectedProfile.requiresSemanticBudget ? (
          <p className="sample-note" style={{ marginTop: '-6px', color: 'var(--warning)' }}>
            Semantic profile is lossy. It needs a positive budget and is meant for aggressive prompt
            packing, not exact formatting fidelity.
          </p>
        ) : null}
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

      <section className="card workflow-card">
        <div className="notes-header">
          <div>
            <p className="panel-label">Inspect-First Workflow</p>
            <strong>
              Use the playground to feel the behavior, then wire the same flow into the real
              surface.
            </strong>
          </div>
          {workflowNotice ? <span className="workflow-notice">{workflowNotice}</span> : null}
        </div>
        <div className="workflow-grid">
          <article className="workflow-step">
            <p className="panel-label">Current payload</p>
            <strong>{workflowInsightTitle}</strong>
            <p>{workflowInsightBody}</p>
          </article>
          <article className="workflow-step">
            <p className="panel-label">CLI handoff</p>
            <strong>Inspect first, then pack only when it helps.</strong>
            <pre className="workflow-code">{WORKFLOW_SNIPPET_PREVIEW.cli}</pre>
            <p className="sample-note">
              Copy action includes your current Input payload in a shell-safe encoded form so the
              snippet runs as pasted.
            </p>
            <button className="ghost" type="button" onClick={() => void handleCopyWorkflow('cli')}>
              Copy CLI snippet
            </button>
          </article>
          <article className="workflow-step">
            <p className="panel-label">MCP handoff</p>
            <strong>Run PAKT as a local stdio MCP server for agents.</strong>
            <pre className="workflow-code">{WORKFLOW_SNIPPET_PREVIEW.mcp}</pre>
            <button className="ghost" type="button" onClick={() => void handleCopyWorkflow('mcp')}>
              Copy MCP config
            </button>
          </article>
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
                <button
                  className="secondary"
                  type="button"
                  onClick={handleDecompress}
                  disabled={decompressButtonDisabled}
                >
                  {decompressButtonLabel}
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
              <strong>Original vs real PAKT profiles vs table-aware candidates</strong>
            </div>
            <span className="compare-caption">
              Compare Layers benchmarks structure-only, standard, tokenizer-aware, and semantic
              profiles when a budget is set, then recommends the smallest output.
            </span>
          </div>
          {packedInputDetected ? (
            <div className="card compare-empty">
              <strong>Restore the payload first</strong>
              <p>Comparison mode expects a raw source document, not already-packed PAKT output.</p>
            </div>
          ) : comparisonState.items ? (
            <>
              {comparisonState.recommendation ? (
                <article className="card recommendation-card">
                  <div>
                    <p className="panel-label">Auto-pack recommendation</p>
                    <strong>{comparisonState.recommendation.title}</strong>
                    <p className="recommendation-copy">{comparisonState.recommendation.body}</p>
                  </div>
                  <div className="recommendation-meta">
                    <span>{comparisonState.recommendation.winnerLabel}</span>
                    <strong>{comparisonState.recommendation.tokens.toLocaleString()} tokens</strong>
                    {tableProjectionWinner ? (
                      <p className="recommendation-warning">
                        Projection warning: Restore returns the projected table layout, not the
                        original source wrapper.
                      </p>
                    ) : null}
                    {comparisonState.recommendation.packedOutput ? (
                      <button className="ghost" type="button" onClick={handleApplyComparisonWinner}>
                        {tableProjectionWinner
                          ? 'Use projection in Playground'
                          : 'Use winner in Playground'}
                      </button>
                    ) : null}
                  </div>
                </article>
              ) : null}
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
                    <div className="compare-badge-row">
                      {getResultBadges(item).map((badge) => (
                        <span key={badge} className="meta-badge">
                          {badge}
                        </span>
                      ))}
                    </div>
                    <p className="compare-delta">{item.delta}</p>
                    <p className="compare-note">{item.note}</p>
                    <pre className="compare-preview">{item.text}</pre>
                  </article>
                ))}
              </div>
            </>
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
