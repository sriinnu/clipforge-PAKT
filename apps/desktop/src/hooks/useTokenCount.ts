import { countTokens } from '@yugenlab/pakt';
import { useMemo } from 'react';

/**
 * Hook that wraps countTokens() from pakt-core.
 * Memoizes the result to avoid re-encoding on every render.
 */
export function useTokenCount(text: string, model?: string): number {
  return useMemo(() => {
    if (!text) return 0;
    try {
      return countTokens(text, model);
    } catch {
      return 0;
    }
  }, [text, model]);
}
