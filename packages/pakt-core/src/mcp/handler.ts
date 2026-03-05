/**
 * @module mcp/handler
 * MCP tool handler for PAKT compression tools.
 *
 * Provides {@link handlePaktTool}, the main dispatch function that routes
 * incoming MCP tool calls to the appropriate pakt-core functions. This
 * handler validates arguments, calls the compression/decompression pipeline,
 * and returns strongly-typed results.
 *
 * @example
 * ```ts
 * import { handlePaktTool } from '@sriinnu/pakt';
 *
 * // Handle a pakt_compress call
 * const result = handlePaktTool('pakt_compress', {
 *   text: '{"users": [{"name": "Alice"}]}',
 *   format: 'json',
 * });
 * console.log(result.compressed); // PAKT output
 * console.log(result.savings);    // e.g. 35
 * ```
 */

import { compress } from '../compress.js';
import { decompress } from '../decompress.js';
import { detect } from '../detect.js';
import { compressMixed } from '../mixed/index.js';
import type { PaktFormat, PaktOptions } from '../types.js';
import type {
  PaktAutoArgs,
  PaktAutoResult,
  PaktCompressArgs,
  PaktCompressResult,
  PaktToolName,
  PaktToolResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Set of valid format values for runtime validation of the `format` parameter. */
const VALID_FORMATS = new Set<PaktFormat>(['json', 'yaml', 'csv', 'markdown', 'text']);

/**
 * Validate that a value is a non-empty string.
 * @param value - The value to check
 * @param name - Parameter name for error messages
 * @throws Error if value is not a non-empty string
 */
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

/**
 * Validate and narrow a format string to PaktFormat.
 * @param value - The format string to validate
 * @returns The validated PaktFormat, or undefined if not provided
 * @throws Error if value is provided but not a valid format
 */
function validateFormat(value: unknown): PaktFormat | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`format must be a string, got ${typeof value}`);
  }
  if (!VALID_FORMATS.has(value as PaktFormat)) {
    const valid = Array.from(VALID_FORMATS).join(', ');
    throw new Error(`Invalid format "${value}". Valid formats: ${valid}`);
  }
  return value as PaktFormat;
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

/**
 * Handle a `pakt_compress` tool call.
 *
 * Routes to either `compress()` (when a specific format is provided)
 * or `compressMixed()` (for auto-detected / mixed content). Returns
 * the compressed text, savings percentage, and detected format.
 *
 * @param args - Tool arguments with `text` and optional `format`
 * @returns Compression result with savings metadata
 */
function handleCompress(args: PaktCompressArgs): PaktCompressResult {
  assertNonEmptyString(args.text, 'text');
  const format = validateFormat(args.format);

  if (format) {
    // Caller specified a format -- use direct compression
    const options: Partial<PaktOptions> = { fromFormat: format };
    const result = compress(args.text, options);
    return {
      compressed: result.compressed,
      savings: result.savings.totalPercent,
      format: result.detectedFormat,
    };
  }

  // No format specified -- use mixed-content pipeline for best results
  const detected = detect(args.text);

  // If the input is already PAKT, return as-is
  if (detected.format === 'pakt') {
    return {
      compressed: args.text,
      savings: 0,
      format: 'pakt',
    };
  }

  // For structured formats, use direct compression
  if (detected.format === 'json' || detected.format === 'yaml' || detected.format === 'csv') {
    const result = compress(args.text, { fromFormat: detected.format });
    return {
      compressed: result.compressed,
      savings: result.savings.totalPercent,
      format: result.detectedFormat,
    };
  }

  // For text/markdown, try mixed-content compression
  const mixedResult = compressMixed(args.text);
  return {
    compressed: mixedResult.compressed,
    savings: mixedResult.savings.totalPercent,
    format: detected.format,
  };
}

/**
 * Handle a `pakt_auto` tool call.
 *
 * Auto-detects whether the input is PAKT or raw text:
 * - PAKT input is decompressed to the original format.
 * - Raw input is compressed using the mixed-content pipeline.
 *
 * @param args - Tool arguments with `text`
 * @returns Auto result with action taken and optional savings
 */
function handleAuto(args: PaktAutoArgs): PaktAutoResult {
  assertNonEmptyString(args.text, 'text');

  const detected = detect(args.text);

  if (detected.format === 'pakt') {
    // Input is PAKT -- decompress it
    const result = decompress(args.text);
    return {
      result: result.text,
      action: 'decompressed',
    };
  }

  // Raw input -- compress it
  const compressResult = compressMixed(args.text);
  return {
    result: compressResult.compressed,
    action: 'compressed',
    savings: compressResult.savings.totalPercent,
  };
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch an MCP tool call to the appropriate PAKT handler.
 *
 * This is the primary entry point for MCP server integrations. It validates
 * the tool name, casts the arguments to the correct type, and delegates
 * to the appropriate handler function.
 *
 * @param name - The MCP tool name ('pakt_compress' or 'pakt_auto')
 * @param args - The tool arguments (shape depends on tool name)
 * @returns The tool result (shape depends on tool name)
 * @throws Error if the tool name is unknown or arguments are invalid
 *
 * @example
 * ```ts
 * import { handlePaktTool } from '@sriinnu/pakt';
 *
 * // Compress call
 * const compressed = handlePaktTool('pakt_compress', { text: myJson });
 *
 * // Auto call
 * const auto = handlePaktTool('pakt_auto', { text: unknownInput });
 * ```
 */
export function handlePaktTool(name: PaktToolName, args: Record<string, unknown>): PaktToolResult {
  switch (name) {
    case 'pakt_compress':
      return handleCompress(args as unknown as PaktCompressArgs);
    case 'pakt_auto':
      return handleAuto(args as unknown as PaktAutoArgs);
    default: {
      // Exhaustive check -- TypeScript will error if a new tool name is added
      const _exhaustive: never = name;
      throw new Error(`Unknown PAKT MCP tool: "${String(_exhaustive)}"`);
    }
  }
}
