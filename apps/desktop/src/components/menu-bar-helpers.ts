/**
 * Pure derivation helpers for the menu-bar panel — these compute the
 * static copy strings shown in the command card based on the live
 * compactor / clipboard state.
 *
 * Kept as standalone exports so they can be unit-tested without rendering.
 */

import type { TransformAction } from './menu-bar-constants';

/**
 * Inputs for {@link deriveCommandCopy} — wraps the small slice of state
 * the title/body computation actually depends on.
 */
export interface CommandCopyInput {
  isProcessing: boolean;
  hasOutput: boolean;
  outputHasError: boolean;
  lastAction: TransformAction;
}

/**
 * Title + body strings for the "Quick Actions" command card. Order of
 * branches: in-flight transform → error → packed-ready → idle.
 */
export function deriveCommandCopy({
  isProcessing,
  hasOutput,
  outputHasError,
  lastAction,
}: CommandCopyInput): { title: string; body: string } {
  const title = isProcessing
    ? 'Transforming the current payload'
    : outputHasError
      ? 'The latest output needs attention'
      : hasOutput
        ? 'Packed output is ready'
        : 'Clipboard workspace is ready';

  const body = isProcessing
    ? 'The active transform is running inside the tray shell.'
    : outputHasError
      ? 'Adjust the source or restore format, then run the next action.'
      : lastAction === 'compress'
        ? 'Copy the packed result or restore it directly from this panel.'
        : 'Pull the clipboard in, review the detected format and active profile, then pack or restore as needed.';

  return { title, body };
}

/**
 * Caption shown under the source textarea. Reads "Loaded from the
 * clipboard." when a clipboard read populated the input, otherwise the
 * default paste hint.
 */
export function deriveSourceMeta(clipboardLoaded: boolean): string {
  return clipboardLoaded
    ? 'Loaded from the clipboard.'
    : 'Paste JSON, YAML, CSV, Markdown, or text.';
}

/**
 * Caption shown under the output textarea — error / ready / empty.
 */
export function deriveOutputMeta(hasOutput: boolean, outputHasError: boolean): string {
  if (outputHasError) return 'The output area contains the latest error.';
  if (hasOutput) return 'Copy the result or restore it into the selected format.';
  return 'Packed or restored output appears here.';
}

/**
 * Status line under the output textarea. Three branches: error, no
 * output, lossy run, lossless run.
 */
export function deriveOutputStatus(
  hasOutput: boolean,
  outputHasError: boolean,
  runIsLossless: boolean,
): string {
  if (outputHasError) return 'Review the error message above.';
  if (!hasOutput) return 'No output yet.';
  return runIsLossless
    ? 'Output is ready for copy or restore.'
    : 'Output is ready, but the active run used lossy semantic compression.';
}

/**
 * Label inside the copy-state chip beside the output panel.
 */
export function deriveCopyBadge(
  copyState: 'idle' | 'success' | 'error',
  outputHasError: boolean,
): string {
  if (copyState === 'success') return 'Copied';
  if (copyState === 'error') return 'Clipboard failed';
  return outputHasError ? 'Needs review' : 'Ready';
}

/**
 * Label for the "Copy output" button itself — flips to a transient
 * confirmation while the copy-state chip is active, then resets after
 * `COPY_STATE_RESET_MS` (the parent owns the timer).
 */
export function deriveCopyButtonLabel(copyState: 'idle' | 'success' | 'error'): string {
  if (copyState === 'success') return 'Copied';
  if (copyState === 'error') return 'Copy failed';
  return 'Copy output';
}

/** Detect macOS for hotkey display only — DOM-side, no Tauri call. */
export function isMacOSPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /(Mac|iPhone|iPad)/i.test(`${navigator.platform} ${navigator.userAgent}`);
}
