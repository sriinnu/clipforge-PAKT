import type { FC } from 'react';

interface TokenBarProps {
  originalTokens: number;
  compressedTokens: number;
}

const TokenBar: FC<TokenBarProps> = ({ originalTokens, compressedTokens }) => {
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
