/**
 * Pure helper functions used by the {@link App} component to derive
 * display strings, badge lists, and workflow snippets from raw state.
 *
 * Everything in this module is deterministic and side-effect free so the
 * App.tsx render path stays readable as state → JSX. Tests in
 * `App.test.tsx` exercise them indirectly via the rendered DOM.
 */

import { type CompressibilityResult, getPaktLayerProfile } from '@sriinnu/pakt';
import type { Action } from './app-constants';
import type { ComparisonItem } from './pakt-runtime';

/* ---------------------------------------------------------------------------
 * Token-delta formatters
 * ------------------------------------------------------------------------- */

/**
 * Human-readable summary of how many tokens were saved or expanded.
 *
 * @param before - Token count of the source input.
 * @param after - Token count of the produced output.
 * @returns Localized phrase such as `"42 tokens saved"` / `"3 tokens expanded"`,
 *   or `"No token change"` when the counts are identical.
 */
export function formatDelta(before: number, after: number): string {
  const delta = before - after;
  if (delta === 0) return 'No token change';
  const label = delta > 0 ? 'saved' : 'expanded';
  return `${Math.abs(delta).toLocaleString()} tokens ${label}`;
}

/**
 * Percentage delta vs. the input token count (`"N%"` rounded to nearest
 * integer). Returns `"0%"` when `before <= 0` to avoid division by zero.
 */
export function formatPercent(before: number, after: number): string {
  if (before <= 0) return '0%';
  const percent = Math.round(((before - after) / before) * 100);
  return `${percent}%`;
}

/* ---------------------------------------------------------------------------
 * Error / numeric input parsing
 * ------------------------------------------------------------------------- */

/**
 * Extract a user-displayable message from an unknown thrown value,
 * falling back to a caller-supplied string when the value is not an
 * `Error` instance.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Parse a positive-integer semantic budget from raw input-field text.
 * Returns `undefined` for empty / non-numeric / non-positive values so
 * callers can treat the budget as "not yet supplied".
 */
export function parseSemanticBudget(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/* ---------------------------------------------------------------------------
 * Workflow snippet builders
 * ------------------------------------------------------------------------- */

/**
 * Normalize the user's Input field for embedding in a shell snippet:
 * strip CR / CRLF and surrounding whitespace, and substitute a small
 * placeholder JSON document when the input is empty so the resulting
 * command is still runnable as pasted.
 */
function getWorkflowPayload(input: string): string {
  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (normalized.length > 0) {
    return normalized;
  }
  return '{"paste":"structured payload here","tip":"then run pakt inspect first"}';
}

/**
 * Encode a UTF-8 string as Base64 using only browser primitives — used
 * to embed the user's payload into a shell snippet without worrying
 * about quoting / escaping rules.
 */
function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Build the "Copy CLI snippet" payload. Embeds the user's current Input
 * payload as a Base64-decoded `node --input-type=module` invocation
 * piped into `pakt inspect` and `pakt auto`, so the snippet is self
 * contained and safe to paste into any shell regardless of quoting.
 *
 * @example
 * ```ts
 * const snippet = buildCliWorkflowSnippet('{"hi":1}');
 * // node --input-type=module -e "..." | pakt inspect
 * // node --input-type=module -e "..." | pakt auto
 * ```
 */
export function buildCliWorkflowSnippet(input: string): string {
  const payloadBase64 = encodeBase64(getWorkflowPayload(input));
  const decodeCommand = `node --input-type=module -e "process.stdout.write(Buffer.from('${payloadBase64}','base64').toString('utf8'))"`;
  return [`${decodeCommand} | pakt inspect`, `${decodeCommand} | pakt auto`].join('\n');
}

/* ---------------------------------------------------------------------------
 * Display-state derivers
 * ------------------------------------------------------------------------- */

/**
 * Color tone for the "What this shows" stat card. `idle` when no output
 * exists yet, `saving` when output ≤ input, `expanded` otherwise.
 */
export function getStatsTone(
  hasOutput: boolean,
  before: number,
  after: number,
): 'idle' | 'saving' | 'expanded' {
  if (!hasOutput) return 'idle';
  return after <= before ? 'saving' : 'expanded';
}

/**
 * Header label shown above the output textarea, derived from the last
 * action and live-preview state. Centralised here so the component
 * doesn't have to thread the same conditional logic through JSX.
 */
export function getOutputLabel(
  lastAction: Action,
  liveCompress: boolean,
  packedInputDetected: boolean,
): string {
  if (liveCompress && packedInputDetected) return 'Ready to restore';
  if (liveCompress && lastAction === 'compress') return 'Live PAKT output';
  if (!lastAction) return 'Output preview';
  return lastAction === 'compress' ? 'PAKT output' : 'Restored output';
}

/**
 * Title + body copy for the "What this shows" stat card. The four
 * branches map to: packed-input detected, live compress in progress,
 * manual compress complete, manual decompress complete, idle.
 */
export function getActionSummary(
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

/**
 * Build the badge list for one comparison-grid card. The set depends on
 * whether the item is a layout projection, a profile result, or the raw
 * source baseline.
 */
export function getResultBadges(item: ComparisonItem): string[] {
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

/* ---------------------------------------------------------------------------
 * Display-state derivation (button labels, hints, workflow insight copy)
 * ------------------------------------------------------------------------- */

/**
 * Inputs required to derive every "what should the UI say right now"
 * string from the {@link App} state. Grouped into one object so the
 * helper can be called as a single line in the component.
 */
export interface DeriveDisplayStateInput {
  semanticBudgetValid: boolean;
  livePreviewEnabled: boolean;
  pendingAction: Action;
  packedInputDetected: boolean;
  inputEmpty: boolean;
  manualActionInFlight: boolean;
  output: string;
  inputTokens: number;
  outputTokens: number;
  profileShortLabel: string;
  profileLabel: string;
  profileReversible: boolean;
}

/**
 * All derived display strings rendered by {@link App}. Centralised
 * here so the component file doesn't have to inline the conditional
 * ladders for each one.
 */
export interface AppDisplayState {
  compressButtonLabel: string;
  decompressButtonLabel: string;
  compressButtonDisabled: boolean;
  decompressButtonDisabled: boolean;
  actionHint: string;
  workflowInsightTitle: string;
  workflowInsightBody: string;
}

/**
 * Compute every label / hint / workflow-insight string from the parent
 * state in one pass. Pure, so easy to unit test if needed later.
 *
 * Internally delegates to small per-section helpers (`deriveButtons`,
 * `deriveActionHint`, `deriveWorkflowInsight`) to keep each branch
 * trivially scannable.
 */
export function deriveDisplayState(s: DeriveDisplayStateInput): AppDisplayState {
  const buttons = deriveButtons(s);
  const actionHint = deriveActionHint(s);
  const insight = deriveWorkflowInsight(s);
  return { ...buttons, actionHint, ...insight };
}

/* Compute the four button-related strings. */
function deriveButtons(s: DeriveDisplayStateInput): {
  compressButtonLabel: string;
  decompressButtonLabel: string;
  compressButtonDisabled: boolean;
  decompressButtonDisabled: boolean;
} {
  const compressButtonLabel = !s.semanticBudgetValid
    ? 'Semantic budget required'
    : s.livePreviewEnabled
      ? 'Live preview running'
      : s.pendingAction === 'compress'
        ? 'Compressing...'
        : s.packedInputDetected
          ? 'Input already packed'
          : 'Preview PAKT';

  const decompressButtonLabel =
    s.pendingAction === 'decompress' ? 'Restoring...' : 'Restore from PAKT';

  const compressButtonDisabled =
    s.inputEmpty ||
    s.packedInputDetected ||
    s.livePreviewEnabled ||
    s.manualActionInFlight ||
    !s.semanticBudgetValid;

  const decompressButtonDisabled = s.inputEmpty || s.manualActionInFlight;

  return {
    compressButtonLabel,
    decompressButtonLabel,
    compressButtonDisabled,
    decompressButtonDisabled,
  };
}

/* Choose the contextual hint shown under the action buttons. */
function deriveActionHint(s: DeriveDisplayStateInput): string {
  if (!s.semanticBudgetValid) {
    return 'Semantic profile needs a positive token budget before preview or compression can run.';
  }
  if (s.packedInputDetected) {
    return 'Input already looks like PAKT. Restore it from the current Input payload using the format selector.';
  }
  if (s.livePreviewEnabled) {
    return `Live preview is on. Typing recomputes ${s.profileShortLabel} immediately.`;
  }
  return 'Manual mode is on. Preview PAKT runs on the current Input payload, and Restore from PAKT expects packed text in Input.';
}

/* Compute the workflow insight title + body. Branches: packed > saving
   > break-even > idle. */
function deriveWorkflowInsight(s: DeriveDisplayStateInput): {
  workflowInsightTitle: string;
  workflowInsightBody: string;
} {
  const hasOutputWithTokens = Boolean(s.output) && s.outputTokens > 0;
  const isSaving = hasOutputWithTokens && s.outputTokens < s.inputTokens;
  const isBreakEven = hasOutputWithTokens && s.outputTokens >= s.inputTokens;

  if (s.packedInputDetected) {
    return {
      workflowInsightTitle: 'Current payload is already packed',
      workflowInsightBody:
        'Use Restore from PAKT to verify the round-trip, then hand the same payload into the CLI, MCP server, or extension.',
    };
  }
  if (isSaving) {
    return {
      workflowInsightTitle: `${s.profileLabel} looks worth using`,
      workflowInsightBody: s.profileReversible
        ? 'This is the kind of payload that should graduate from the playground into your CLI, MCP, extension, or desktop workflow.'
        : 'This lossy profile saves tokens here. Keep it for aggressive prompt packing, not exact round-trip guarantees.',
    };
  }
  if (isBreakEven) {
    return {
      workflowInsightTitle: `${s.profileLabel} is near break-even`,
      workflowInsightBody:
        'This payload is useful for testing, but it is not a strong launch demo. Try a repeated JSON table or mixed markdown sample.',
    };
  }
  return {
    workflowInsightTitle: 'Inspect the payload before you wire it in',
    workflowInsightBody:
      'Start with Compare Layers or Live PAKT preview, then move the winning payload into the CLI or MCP surface.',
  };
}

/* ---------------------------------------------------------------------------
 * Compressibility hint (used only as a re-export to centralise types)
 * ------------------------------------------------------------------------- */

/** Re-export so consumers don't need a second import path for the type. */
export type { CompressibilityResult };
