/**
 * @module middleware/interceptor
 * MCP result interceptor — automatic PAKT compression for tool results.
 * Embeddable in any MCP server, API proxy, or framework middleware.
 */

import { compress } from '../compress.js';
import { detect } from '../detect.js';
import { countTokens } from '../tokens/index.js';
import type { PaktFormat, PaktSavings } from '../types.js';
import type {
  InterceptorConfig,
  InterceptorResult,
  InterceptorStats,
  OptimizeResult,
  ToolResultMessage,
} from './types.js';

const DEFAULTS: Required<InterceptorConfig> = {
  minTokens: 100,
  maxInputSize: 512_000,
  formats: ['json', 'yaml', 'csv'],
  passthrough: ['pakt_*'],
  targetModel: 'gpt-4o',
};

const ZERO_SAVINGS: PaktSavings = {
  totalPercent: 0,
  totalTokens: 0,
  byLayer: { structural: 0, dictionary: 0, tokenizer: 0, semantic: 0, content: 0 },
};

/** Check whether a tool name matches any passthrough glob pattern. */
function matchesPassthrough(toolName: string, patterns: string[]): boolean {
  return patterns.some((p) =>
    p.endsWith('*') ? toolName.startsWith(p.slice(0, -1)) : toolName === p,
  );
}

/** The interceptor instance returned by {@link createPaktInterceptor}. */
export interface PaktInterceptor {
  /** Compress a single tool result if beneficial. */
  processToolResult(toolName: string, rawResult: string): InterceptorResult;
  /** Cumulative session savings. */
  getStats(): InterceptorStats;
  /** Reset session counters. */
  resetStats(): void;
}

/** Create a PAKT interceptor that auto-compresses structured tool results. */
export function createPaktInterceptor(config?: InterceptorConfig): PaktInterceptor {
  const cfg = { ...DEFAULTS, ...config };
  const allowedFormats = new Set<string>(cfg.formats);
  const skip = (text: string, reason: string): InterceptorResult =>
    ({ text, wasPaktCompressed: false, savings: ZERO_SAVINGS, skipReason: reason });

  let stats: InterceptorStats = {
    totalCalls: 0, compressedCalls: 0,
    totalOriginalTokens: 0, totalCompressedTokens: 0, totalSavedTokens: 0,
  };

  function processToolResult(toolName: string, rawResult: string): InterceptorResult {
    stats.totalCalls++;
    if (matchesPassthrough(toolName, cfg.passthrough)) return skip(rawResult, 'passthrough tool');
    if (rawResult.length > cfg.maxInputSize) return skip(rawResult, 'exceeds maxInputSize');

    const detection = detect(rawResult);
    if (!allowedFormats.has(detection.format)) return skip(rawResult, `format '${detection.format}' not in allowed list`);

    const originalTokens = countTokens(rawResult, cfg.targetModel);
    if (originalTokens < cfg.minTokens) return skip(rawResult, 'below minTokens threshold');

    const result = compress(rawResult, { fromFormat: detection.format as PaktFormat, targetModel: cfg.targetModel });
    if (result.compressedTokens >= originalTokens) return skip(rawResult, 'compression did not reduce tokens');

    const saved = originalTokens - result.compressedTokens;
    stats.compressedCalls++;
    stats.totalOriginalTokens += originalTokens;
    stats.totalCompressedTokens += result.compressedTokens;
    stats.totalSavedTokens += saved;
    return { text: result.compressed, wasPaktCompressed: true, savings: result.savings };
  }

  return {
    processToolResult,
    getStats: () => ({ ...stats }),
    resetStats: () => { stats = { totalCalls: 0, compressedCalls: 0, totalOriginalTokens: 0, totalCompressedTokens: 0, totalSavedTokens: 0 }; },
  };
}

/**
 * Process a messages array for an LLM API call.
 * Finds tool-result messages with structured content, compresses them in-place.
 */
export function optimizeMessages(messages: ToolResultMessage[], config?: InterceptorConfig): OptimizeResult {
  const interceptor = createPaktInterceptor(config);

  for (const msg of messages) {
    if (msg.role !== 'tool') continue;
    if (typeof msg.content === 'string') {
      const r = interceptor.processToolResult('tool_result', msg.content);
      if (r.wasPaktCompressed) msg.content = r.text;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          const r = interceptor.processToolResult('tool_result', block.text);
          if (r.wasPaktCompressed) block.text = r.text;
        }
      }
    }
  }
  return { messages, savings: interceptor.getStats() };
}
