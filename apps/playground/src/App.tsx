/**
 * Top-level playground component.
 *
 * Owns ALL state and event handlers. Effects are delegated to custom
 * hooks in `./app-effects`, derived display strings to `./app-helpers`,
 * and presentation to the `./components/*` modules so this file stays
 * under the project's 450-LOC cap.
 */

import type { CacheBreakpoint, CacheTarget, PaktFormat, PaktLayerProfileId } from '@sriinnu/pakt';
// Lightweight, tokenizer-free metadata — keeps the BPE engine out of the main bundle.
import { DEFAULT_SEMANTIC_BUDGET, getPaktLayerProfile } from '@sriinnu/pakt/meta';
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Action,
  TARGET_MODELS,
  type ViewMode,
  WORKFLOW_SNIPPET_PREVIEW,
} from './app-constants';
import { useComparison, useCompressibilityEstimator, useLivePreview } from './app-effects';
import {
  type CompressibilityResult,
  buildCliWorkflowSnippet,
  deriveDisplayState,
  getActionSummary,
  getOutputLabel,
  getStatsTone,
  parseSemanticBudget,
} from './app-helpers';
import { AppHero } from './components/AppHero';
import { CompareLayersView } from './components/CompareLayersView';
import { ContextEngineView } from './components/ContextEngineView';
import { ControlsCard } from './components/ControlsCard';
import { NotesAndWorkflowCards } from './components/NotesAndWorkflowCards';
import { PackerView } from './components/PackerView';
import { PlaygroundWorkspace } from './components/PlaygroundWorkspace';
import {
  type ComparisonState,
  compressSource,
  decompressSource,
  preloadPaktRuntime,
} from './pakt-runtime';
import { samples } from './samples';

export default function App() {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const initialSample = samples[0];
  const [viewMode, setViewMode] = useState<ViewMode>('playground');
  const [selectedSample, setSelectedSample] = useState(initialSample?.id ?? '');
  const [compressionProfileId, setCompressionProfileId] = useState<PaktLayerProfileId>('standard');
  const [targetModel, setTargetModel] = useState<string>(TARGET_MODELS[0]?.id ?? 'gpt-4o');
  const [cacheTarget, setCacheTarget] = useState<CacheTarget | undefined>(undefined);
  const [cacheBreakpoint, setCacheBreakpoint] = useState<CacheBreakpoint | null>(null);
  const [lossy, setLossy] = useState<boolean>(false);
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
  /** Compressibility score for the current input, computed in the worker. */
  const [compressibility, setCompressibility] = useState<CompressibilityResult | null>(null);
  const suppressPreviewOnceRef = useRef(false);
  const manualRequestIdRef = useRef(0);
  const deferredInput = useDeferredValue(input);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------
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
      targetModel,
      ...(cacheTarget ? { cacheTarget } : {}),
    }),
    [compressionProfileId, semanticBudget, targetModel, cacheTarget],
  );

  const livePreviewEnabled = liveCompress && !packedInputDetected && semanticBudgetValid;
  const manualActionInFlight = pendingAction !== null;
  const display = deriveDisplayState({
    semanticBudgetValid,
    livePreviewEnabled,
    pendingAction,
    packedInputDetected,
    inputEmpty: !input.trim(),
    manualActionInFlight,
    output,
    inputTokens,
    outputTokens,
    profileShortLabel: selectedProfile.shortLabel,
    profileLabel: selectedProfile.label,
    profileReversible: selectedProfile.reversible,
  });

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
  const currentSample = samples.find((sample) => sample.id === selectedSample);

  /** Cancel any in-flight manual action so a fresh one can take over. */
  function invalidatePendingAction(): void {
    manualRequestIdRef.current += 1;
    setPendingAction(null);
  }

  // ---------------------------------------------------------------------------
  // Effects (worker warm-up + delegated hooks)
  // ---------------------------------------------------------------------------

  // Best-effort worker warm-up so the first user action isn't blocked
  // on the bundle / wasm download.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void preloadPaktRuntime().catch(() => {
        /* Warm-up is best-effort; explicit actions surface worker failures. */
      });
    }, 150);
    return () => window.clearTimeout(timeoutId);
  }, []);

  // Surface the budget-required error banner when the semantic profile
  // is selected but the budget input is empty / non-numeric.
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

  useCompressibilityEstimator(deferredInput, setCompressibility);

  /* Clear any leftover cacheBreakpoint immediately when the user turns
     off the cache target. Without this, the previously-displayed hint
     would linger until the next live-preview tick (which may not fire
     when liveCompress is off or input is empty). */
  useEffect(() => {
    if (!cacheTarget) setCacheBreakpoint(null);
  }, [cacheTarget]);

  useLivePreview(deferredInput, liveCompress, compressionConfig, suppressPreviewOnceRef, {
    setDetectedFormat,
    setInputTokens,
    setPackedInputDetected,
    setOutput,
    setOutputTokens,
    setLastAction,
    setError,
    setCacheBreakpoint,
    setLossy,
  });

  useComparison(
    viewMode === 'compare',
    deferredInput,
    packedInputDetected,
    semanticBudget,
    targetModel,
    cacheTarget,
    setComparisonState,
  );

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

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

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: orchestrates multi-step compression with validation and error handling
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
      setCacheBreakpoint(next.cacheBreakpoint ?? null);
      setLossy(next.lossy === true);
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
      const next = await decompressSource(input, decompressTo, targetModel);
      if (manualRequestIdRef.current !== requestId) return;
      setDetectedFormat(next.detectedFormat);
      setInputTokens(next.inputTokens);
      setPackedInputDetected(next.packedInputDetected);
      setOutput(next.output);
      setOutputTokens(next.outputTokens);
      setCacheBreakpoint(null);
      setLossy(false);
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

  function handleClearOutput(): void {
    setOutput('');
    setOutputTokens(0);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="shell">
      <AppHero
        viewMode={viewMode}
        detectedFormat={detectedFormat}
        profileShortLabel={selectedProfile.shortLabel}
        currentSampleLabel={currentSample?.label ?? 'Custom'}
        onViewModeChange={setViewMode}
      />

      {viewMode !== 'context' ? (
        <>
          <ControlsCard
            samples={samples}
            selectedSample={selectedSample}
            compressionProfileId={compressionProfileId}
            selectedProfile={selectedProfile}
            targetModel={targetModel}
            cacheTarget={cacheTarget}
            semanticBudgetInput={semanticBudgetInput}
            onSampleChange={loadSample}
            onProfileChange={setCompressionProfileId}
            onTargetModelChange={setTargetModel}
            onCacheTargetChange={setCacheTarget}
            onSemanticBudgetChange={setSemanticBudgetInput}
          />

          <NotesAndWorkflowCards
            workflowNotice={workflowNotice}
            insightTitle={display.workflowInsightTitle}
            insightBody={display.workflowInsightBody}
            onCopyWorkflow={(label) => void handleCopyWorkflow(label)}
          />
        </>
      ) : null}

      {viewMode === 'playground' ? (
        <PlaygroundWorkspace
          detectedFormat={detectedFormat}
          input={input}
          inputTokens={inputTokens}
          compressibility={compressibility}
          liveCompress={liveCompress}
          compressButtonLabel={display.compressButtonLabel}
          compressButtonDisabled={display.compressButtonDisabled}
          decompressButtonLabel={display.decompressButtonLabel}
          decompressButtonDisabled={display.decompressButtonDisabled}
          decompressTo={decompressTo}
          actionHint={display.actionHint}
          outputLabel={outputLabel}
          output={output}
          outputTokens={outputTokens}
          packedInputDetected={packedInputDetected}
          statsTone={statsTone}
          actionSummary={actionSummary}
          cacheBreakpoint={cacheBreakpoint}
          cacheTarget={cacheTarget}
          lossy={lossy}
          onInputChange={handleInputChange}
          onLiveCompressChange={setLiveCompress}
          onCompress={handleCompress}
          onDecompress={handleDecompress}
          onDecompressToChange={setDecompressTo}
          onSwap={handleSwap}
          onClearOutput={handleClearOutput}
          onCopyOutput={() => void handleCopy()}
        />
      ) : viewMode === 'compare' ? (
        <CompareLayersView
          comparisonState={comparisonState}
          packedInputDetected={packedInputDetected}
          tableProjectionWinner={tableProjectionWinner}
          onApplyWinner={handleApplyComparisonWinner}
        />
      ) : viewMode === 'packer' ? (
        <PackerView />
      ) : <ContextEngineView />}

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      <footer className="footer">
        <span>PAKT v{__PAKT_VERSION__}</span>
        <span>&copy; {new Date().getFullYear()} Sriinnu</span>
        <span>Local browser playground for structured payload testing</span>
      </footer>
    </div>
  );
}
