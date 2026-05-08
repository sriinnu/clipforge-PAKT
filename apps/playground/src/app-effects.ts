/**
 * Custom hooks that own the playground's three asynchronous side effects:
 * compressibility estimation, live preview / format detection, and the
 * comparison view recompute.
 *
 * Split out of {@link App} so the component file stays under the
 * project's 450-LOC cap. Each hook is a thin wrapper around the
 * corresponding worker call in `./pakt-runtime`, with debouncing and
 * cancellation logic kept identical to the previous inline `useEffect`s.
 */

import type {
  CacheBreakpoint,
  CacheTarget,
  CompressibilityResult,
  PaktFormat,
  PaktLayerProfileId,
} from '@sriinnu/pakt';
import { type MutableRefObject, startTransition, useEffect, useRef } from 'react';
import type { Action } from './app-constants';
import { getErrorMessage } from './app-helpers';
import {
  type ComparisonState,
  analyzePreview,
  computeComparison,
  estimateCompressibility,
} from './pakt-runtime';

/**
 * Debounced compressibility estimator. Updates `setCompressibility(null)`
 * for empty input and otherwise calls the worker after a 200ms idle.
 */
export function useCompressibilityEstimator(
  deferredInput: string,
  setCompressibility: (value: CompressibilityResult | null) => void,
): void {
  useEffect(() => {
    if (!deferredInput.trim()) {
      setCompressibility(null);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        const result = await estimateCompressibility(deferredInput);
        if (!cancelled) setCompressibility(result);
      } catch {
        /* Best-effort: compressibility indicator is non-critical */
        if (!cancelled) setCompressibility(null);
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [deferredInput, setCompressibility]);
}

/**
 * Setter callbacks the {@link useLivePreview} hook needs to push state
 * back into {@link App}. Grouped to keep the hook signature short.
 */
export interface LivePreviewSetters {
  setDetectedFormat: (format: PaktFormat) => void;
  setInputTokens: (count: number) => void;
  setPackedInputDetected: (value: boolean) => void;
  setOutput: (value: string) => void;
  setOutputTokens: (count: number) => void;
  setLastAction: (action: Action) => void;
  setError: (message: string | null) => void;
  setCacheBreakpoint: (hint: CacheBreakpoint | null) => void;
}

/**
 * Live preview / format detection effect. Debounced at 120ms when
 * `liveCompress` is on, immediate otherwise. The
 * `suppressPreviewOnceRef` flag lets the parent skip a single output
 * update (used by the swap handler).
 */
export function useLivePreview(
  deferredInput: string,
  liveCompress: boolean,
  compressionConfig: {
    profileId: PaktLayerProfileId;
    semanticBudget?: number;
    targetModel: string;
    cacheTarget?: CacheTarget;
  },
  suppressPreviewOnceRef: MutableRefObject<boolean>,
  setters: LivePreviewSetters,
): void {
  // Stash the setters bag in a ref so the effect doesn't re-run when the
  // parent recreates the inline object each render. The underlying React
  // state setters are stable, so reading via ref always sees the same
  // function references.
  const settersRef = useRef(setters);
  settersRef.current = setters;

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(
      async () => {
        const s = settersRef.current;
        try {
          const next = await analyzePreview(deferredInput, liveCompress, compressionConfig);
          if (cancelled) return;

          startTransition(() => {
            s.setDetectedFormat(next.detectedFormat);
            s.setInputTokens(next.inputTokens);
            s.setPackedInputDetected(next.packedInputDetected);

            if (suppressPreviewOnceRef.current) {
              suppressPreviewOnceRef.current = false;
              return;
            }

            s.setOutput(next.output);
            s.setOutputTokens(next.outputTokens);
            s.setLastAction(next.lastAction);
            s.setError(next.error);
            s.setCacheBreakpoint(next.cacheBreakpoint ?? null);
          });
        } catch (error) {
          if (cancelled) return;

          startTransition(() => {
            suppressPreviewOnceRef.current = false;
            s.setOutput('');
            s.setOutputTokens(0);
            s.setLastAction(null);
            s.setCacheBreakpoint(null);
            s.setError(getErrorMessage(error, 'Preview unavailable'));
          });
        }
      },
      liveCompress ? 120 : 0,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [compressionConfig, deferredInput, liveCompress, suppressPreviewOnceRef]);
}

/**
 * Comparison-view recompute effect. Resets to idle when compare mode is
 * inactive or input is empty / packed; otherwise debounces at 180ms and
 * calls the worker.
 */
export function useComparison(
  enabled: boolean,
  deferredInput: string,
  packedInputDetected: boolean,
  semanticBudget: number | undefined,
  targetModel: string,
  setComparisonState: (next: ComparisonState) => void,
): void {
  // Mirror the setter through a ref for the same reason as useLivePreview:
  // avoid re-running the effect when the parent identity changes while
  // still calling the latest function.
  const setterRef = useRef(setComparisonState);
  setterRef.current = setComparisonState;

  useEffect(() => {
    const setNext = setterRef.current;
    if (!enabled || !deferredInput.trim() || packedInputDetected) {
      startTransition(() => {
        setNext({
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
      setNext({
        status: 'loading',
        items: null,
        error: null,
        recommendation: null,
      });
    });

    const timeoutId = window.setTimeout(async () => {
      try {
        const next = await computeComparison(deferredInput, semanticBudget, targetModel);
        if (cancelled) return;

        startTransition(() => {
          setterRef.current(next);
        });
      } catch (error) {
        if (cancelled) return;

        startTransition(() => {
          setterRef.current({
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
  }, [enabled, deferredInput, packedInputDetected, semanticBudget, targetModel]);
}
