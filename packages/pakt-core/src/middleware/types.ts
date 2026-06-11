/**
 * @module middleware/types
 * Types for the PAKT middleware interceptor.
 */

import type { PaktFormat, PaktSavings } from '../types.js';

/** Configuration for {@link createPaktInterceptor}. All fields optional. */
export interface InterceptorConfig {
  /** Skip results with fewer tokens than this. @default 100 */
  minTokens?: number;
  /** Skip results larger than this byte count. @default 512_000 */
  maxInputSize?: number;
  /** Formats to auto-detect and compress. @default ['json','yaml','csv'] */
  formats?: PaktFormat[];
  /** Tool name patterns to never compress. @default ['pakt_*'] */
  passthrough?: string[];
  /** Target model for token counting. @default 'gpt-4o' */
  targetModel?: string;
}

/** Metadata returned alongside every processed tool result. */
export interface InterceptorResult {
  /** The (possibly compressed) text. */
  text: string;
  /** True when PAKT compression was applied and saved tokens. */
  wasPaktCompressed: boolean;
  /** Savings metrics — zeroed when compression was skipped. */
  savings: PaktSavings;
  /** Why compression was skipped, if it was. */
  skipReason?: string;
}

/** Cumulative savings tracked across all interceptor calls in a session. */
export interface InterceptorStats {
  totalCalls: number;
  compressedCalls: number;
  totalOriginalTokens: number;
  totalCompressedTokens: number;
  totalSavedTokens: number;
}

/** Minimal message shape matching Anthropic/OpenAI SDK tool-result messages. */
export interface ToolResultMessage {
  role: 'tool' | string;
  content: string | { type: string; text?: string }[];
  [key: string]: unknown;
}

/** Result from {@link optimizeMessages}. */
export interface OptimizeResult {
  messages: ToolResultMessage[];
  savings: InterceptorStats;
}
