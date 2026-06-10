/**
 * The clipboard "Compress" tab of the tray panel — command card, source
 * / output editor grid, and the bottom utility grid.
 *
 * Extracted verbatim from MenuBarPanel when the telemetry tab became
 * the primary surface, so the panel root stays under the LOC cap.
 * Owns only derived display state (copy strings, layer codes); all real
 * state and handlers live in the parent.
 */

import { type FC, type RefObject, useMemo } from 'react';
import type { PaktFormat, PaktLayers } from '@sriinnu/pakt';
import type { CompactorRunResult, CompactorState } from '../hooks/useCompactor';
import { MenuBarBottomGrid } from './MenuBarBottomGrid';
import { MenuBarCommandCard } from './MenuBarCommandCard';
import { MenuBarEditorGrid } from './MenuBarEditorGrid';
import type { TransformAction } from './menu-bar-constants';
import { deriveCommandCopy, deriveOutputMeta, deriveSourceMeta } from './menu-bar-helpers';

/** Props for {@link CompressWorkspace} — state owned by MenuBarPanel. */
export interface CompressWorkspaceProps {
  /** Live compactor hook state (input/output/tokens/processing). */
  compactor: CompactorState;
  /** True when the last clipboard read returned content. */
  clipboardHasContent: boolean;
  /** Active compression layers from settings. */
  layers: PaktLayers;
  /** Target model id (token counting / pricing). */
  model: string;
  /** L4 semantic budget from settings. */
  semanticBudget: number;
  /** Restore output format. */
  outputFormat: PaktFormat;
  /** Whether clipboard auto-watch is on. */
  autoCompress: boolean;
  /** Transient copy-confirmation state for the copy button. */
  copyState: 'idle' | 'success' | 'error';
  /** Last transform performed (drives the command-card copy). */
  lastAction: TransformAction;
  /** Result of the last run (drives the lossless badge). */
  lastRun: CompactorRunResult | null;
  /** Display strings for the global hotkeys. */
  packHotkey: string;
  restoreHotkey: string;
  /** Ref to the source textarea (parent focuses it on open). */
  sourceTextareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Replace the source text (invalidates prior output). */
  onSourceChange: (text: string) => void;
  /** Pull the system clipboard into the source. */
  onReadClipboard: () => void;
  onCompress: () => void;
  onRestore: () => void;
  onCopyOutput: () => void;
  onOutputFormatChange: (format: PaktFormat) => void;
  onToggleAutoCompress: () => void;
}

/**
 * Render the full compress workspace (command card + editors + bottom
 * grid). Stateless apart from memoized display derivations.
 */
export const CompressWorkspace: FC<CompressWorkspaceProps> = ({
  compactor,
  clipboardHasContent,
  layers,
  model,
  semanticBudget,
  outputFormat,
  autoCompress,
  copyState,
  lastAction,
  lastRun,
  packHotkey,
  restoreHotkey,
  sourceTextareaRef,
  onSourceChange,
  onReadClipboard,
  onCompress,
  onRestore,
  onCopyOutput,
  onOutputFormatChange,
  onToggleAutoCompress,
}) => {
  const hasOutput = compactor.output.trim().length > 0;
  const outputHasError = hasOutput && compactor.output.startsWith('Error:');

  const activeLayerCodes = useMemo(
    () =>
      [
        layers.structural ? 'L1' : null,
        layers.dictionary ? 'L2' : null,
        layers.tokenizerAware ? 'L3' : null,
        layers.semantic ? 'L4' : null,
      ].filter(Boolean) as string[],
    [layers],
  );

  // A run is lossless unless the semantic layer ran and reported otherwise.
  const runIsLossless = lastRun?.reversible ?? !layers.semantic;

  const { title: commandTitle, body: commandCopy } = deriveCommandCopy({
    isProcessing: compactor.isProcessing,
    hasOutput,
    outputHasError,
    lastAction,
  });
  const sourceMeta = deriveSourceMeta(clipboardHasContent);
  const outputMeta = deriveOutputMeta(hasOutput, outputHasError);

  return (
    <>
      <MenuBarCommandCard
        title={commandTitle}
        body={commandCopy}
        isProcessing={compactor.isProcessing}
        hasInput={compactor.input.trim().length > 0}
        hasOutput={hasOutput}
        outputHasError={outputHasError}
        format={compactor.format}
        output={compactor.output}
        model={model}
        activeLayerCodes={activeLayerCodes}
        showSemanticBudget={layers.semantic}
        semanticBudget={semanticBudget}
        runIsLossless={runIsLossless}
        packHotkey={packHotkey}
        restoreHotkey={restoreHotkey}
        savings={compactor.savings}
        onRead={onReadClipboard}
        onCompress={onCompress}
        onRestore={onRestore}
      />

      <MenuBarEditorGrid
        input={compactor.input}
        format={compactor.format}
        output={compactor.output}
        originalTokens={compactor.originalTokens}
        compressedTokens={compactor.compressedTokens}
        sourceMeta={sourceMeta}
        outputMeta={outputMeta}
        lastAction={lastAction}
        autoCompress={autoCompress}
        sourceTextareaRef={sourceTextareaRef}
        onSourceChange={onSourceChange}
        onPasteClipboard={onReadClipboard}
        hasOutput={hasOutput}
        outputHasError={outputHasError}
        outputFormat={outputFormat}
        copyState={copyState}
        runIsLossless={runIsLossless}
        onOutputFormatChange={onOutputFormatChange}
        onCopyOutput={onCopyOutput}
      />

      <MenuBarBottomGrid
        autoCompress={autoCompress}
        onToggleAutoCompress={onToggleAutoCompress}
        model={model}
        outputFormat={outputFormat}
        originalTokens={compactor.originalTokens}
        compressedTokens={compactor.compressedTokens}
        compressibilityLabel={compactor.compressibilityLabel}
      />
    </>
  );
};
