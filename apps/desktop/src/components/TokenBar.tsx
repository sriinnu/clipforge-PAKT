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
    originalTokens > 0
      ? Math.max(4, Math.round((compressedTokens / originalTokens) * 100))
      : 100;

  const isActive = originalTokens > 0 && compressedTokens > 0;

  return (
    <div className="space-y-1.5">
      {/* Labels row */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">
          Before:{' '}
          <span className="font-mono text-gray-200">
            {originalTokens.toLocaleString()}
          </span>{' '}
          tokens
        </span>
        {isActive && (
          <span
            className={`rounded-full px-1.5 py-0.5 font-mono text-xs font-semibold ${
              savings > 0
                ? 'bg-green-500/20 text-green-400'
                : 'bg-gray-500/20 text-gray-400'
            }`}
          >
            {savings > 0 ? `-${savings}%` : '0%'}
          </span>
        )}
        <span className="text-gray-400">
          After:{' '}
          <span className="font-mono text-gray-200">
            {compressedTokens.toLocaleString()}
          </span>{' '}
          tokens
        </span>
      </div>

      {/* Progress bar */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-700">
        {/* Original bar (full width, dimmed) */}
        <div className="absolute inset-0 rounded-full bg-gray-600" />
        {/* Compressed bar (proportional width) */}
        {isActive && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-indigo-500 transition-all duration-500 ease-out"
            style={{ width: `${compressedWidth}%` }}
          />
        )}
      </div>

      {/* Tokens saved */}
      {isActive && savings > 0 && (
        <p className="text-center text-[10px] text-gray-500">
          {(originalTokens - compressedTokens).toLocaleString()} tokens saved
        </p>
      )}
    </div>
  );
};

export default TokenBar;
