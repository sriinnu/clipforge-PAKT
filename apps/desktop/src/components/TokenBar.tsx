/**
 * @module TokenBar
 * Displays token counts, savings percentage, and compressibility score
 * for the current compression operation.
 */

import type { CompressibilityLabel } from '@sriinnu/pakt';
import type { FC } from 'react';

interface TokenBarProps {
  originalTokens: number;
  compressedTokens: number;
  /** Human-readable compressibility label from estimateCompressibility(). */
  compressibilityLabel?: CompressibilityLabel | null;
}

/** Maps compressibility labels to Tailwind color classes for the badge. */
const COMPRESSIBILITY_COLORS: Record<CompressibilityLabel, string> = {
  low: 'text-red-300 bg-red-400/10 border-red-300/20',
  moderate: 'text-amber-300 bg-amber-400/10 border-amber-300/20',
  good: 'text-emerald-300 bg-emerald-400/10 border-emerald-300/20',
  high: 'text-sky-300 bg-sky-400/10 border-sky-300/20',
  excellent: 'text-indigo-300 bg-indigo-400/10 border-indigo-300/20',
};

const TokenBar: FC<TokenBarProps> = ({ originalTokens, compressedTokens, compressibilityLabel }) => {
  const savings =
    originalTokens > 0
      ? Math.round(((originalTokens - compressedTokens) / originalTokens) * 100)
      : 0;

  const compressedWidth =
    originalTokens > 0 ? Math.max(4, Math.round((compressedTokens / originalTokens) * 100)) : 100;

  const isActive = originalTokens > 0 && compressedTokens > 0;

  return (
    <div className="desktop-card desktop-token-card">
      <div className="desktop-token-row">
        <span className="desktop-token-label">
          Before <strong>{originalTokens.toLocaleString()}</strong>
        </span>
        {isActive ? (
          <span className="desktop-savings-pill">{savings > 0 ? `-${savings}%` : '0% saved'}</span>
        ) : null}
        {/* Compressibility label badge — shown when compression results exist */}
        {isActive && compressibilityLabel ? (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${COMPRESSIBILITY_COLORS[compressibilityLabel]}`}
          >
            {compressibilityLabel}
          </span>
        ) : null}
        <span className="desktop-token-label">
          After <strong>{compressedTokens.toLocaleString()}</strong>
        </span>
      </div>

      <div className="desktop-progress">
        {isActive ? (
          <div
            className="desktop-progress-fill transition-all duration-500 ease-out"
            style={{ width: `${compressedWidth}%` }}
          />
        ) : null}
      </div>

      {isActive ? (
        <p className="desktop-token-footnote">
          {savings > 0
            ? `${(originalTokens - compressedTokens).toLocaleString()} tokens removed from the payload`
            : 'This payload is roughly break-even right now.'}
        </p>
      ) : null}
    </div>
  );
};

export default TokenBar;
