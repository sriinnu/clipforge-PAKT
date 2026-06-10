/**
 * @module proxy/slim
 * Slim-mode tool compression for the PAKT proxy.
 *
 * When an LLM provider request body contains a `tools` array, this module
 * strips it down losslessly-in-spirit:
 *
 * - Drops `null` and empty-string values from JSON Schema property objects.
 * - Removes `"additionalProperties": false` and top-level `"type": "object"`
 *   where they add no information (tools are never echoed back by the provider,
 *   so this one-way slimming is safe).
 * - Truncates description strings over `descriptionCap` characters at the
 *   last sentence boundary before the cap, appending `…`.
 *
 * Every transformation is reversible in principle but is intentionally
 * one-directional here because the slimmed body is only forwarded to the
 * provider, never returned to the client.
 *
 * TRUTH RULE: when `slim` encounters an unexpected shape it passes that
 * field through unchanged and does not throw.
 */

import { countTokens } from '../tokens/index.js';
import type { ProviderTool, SlimToolOptions, ToolInputSchema, ToolSchemaProperty, ToolSlimSavings } from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Truncate a description string at the last sentence boundary at or before
 * `cap` characters. If no sentence boundary exists, truncates hard at `cap`.
 * Appends `…` when truncation occurs.
 *
 * @param text - The text to (potentially) truncate.
 * @param cap - Maximum character count before truncation (default 1024).
 * @returns The (possibly truncated) string.
 */
export function truncateAtSentence(text: string, cap: number): string {
  if (text.length <= cap) return text;

  const sub = text.slice(0, cap);
  // Try to find the last sentence-ending punctuation in the slice.
  // We look for . ! ? followed by whitespace or end-of-slice.
  const match = sub.match(/^(.*[.!?])[\s]*/s);
  if (match?.[1] && match[1].length > 0) {
    return `${match[1].trimEnd()}…`;
  }
  // No sentence break found — hard cut at last word boundary.
  const wordMatch = sub.match(/^(.*)\s/s);
  if (wordMatch?.[1] && wordMatch[1].length > 0) {
    return `${wordMatch[1].trimEnd()}…`;
  }
  return `${sub.trimEnd()}…`;
}

/**
 * Strip null / empty-string / undefined values from a plain object shallowly.
 * Does NOT recurse — callers invoke it at the level they want cleaned.
 *
 * @param obj - The object to strip.
 * @returns A new object with null/empty-string/undefined keys removed.
 */
function stripNullsShallow(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue;
    out[k] = v;
  }
  return out;
}

/**
 * Slim a single JSON Schema property entry.
 * Strips nulls and drops empty `description` fields.
 *
 * @param prop - The property definition to slim.
 * @param cap - Description character cap.
 * @returns A new (possibly smaller) property object.
 */
function slimProperty(prop: ToolSchemaProperty, cap: number): ToolSchemaProperty {
  const stripped = stripNullsShallow(prop as Record<string, unknown>) as ToolSchemaProperty;

  if (typeof stripped.description === 'string' && stripped.description.length > 0) {
    stripped.description = truncateAtSentence(stripped.description, cap);
  } else {
    // Remove empty descriptions to save bytes.
    delete stripped.description;
  }

  // Recurse into nested `properties` map.
  if (stripped.properties && typeof stripped.properties === 'object') {
    const nestedOut: Record<string, ToolSchemaProperty> = {};
    for (const [name, nested] of Object.entries(stripped.properties)) {
      nestedOut[name] = slimProperty(nested, cap);
    }
    stripped.properties = nestedOut;
  }

  return stripped;
}

/**
 * Slim the `input_schema` (or `parameters`) block of a tool definition.
 *
 * Drops:
 *  - top-level `"type": "object"` (implied by the object shape)
 *  - `"additionalProperties": false` (default assumption, redundant)
 *  - null/empty values
 *
 * @param schema - The input schema block to slim.
 * @param cap - Description character cap.
 * @returns A new, smaller schema object.
 */
function slimInputSchema(schema: ToolInputSchema, cap: number): ToolInputSchema {
  const stripped = stripNullsShallow(schema as Record<string, unknown>) as ToolInputSchema;

  // Drop the redundant type:"object" — the provider already knows tool inputs are objects.
  if (stripped.type === 'object') {
    delete stripped.type;
  }

  // Drop additionalProperties:false — it's the default and adds nothing.
  if (stripped.additionalProperties === false) {
    delete stripped.additionalProperties;
  }

  // Slim individual property entries.
  if (stripped.properties && typeof stripped.properties === 'object') {
    const slimmedProps: Record<string, ToolSchemaProperty> = {};
    for (const [name, prop] of Object.entries(stripped.properties)) {
      slimmedProps[name] = slimProperty(prop, cap);
    }
    stripped.properties = slimmedProps;
  }

  return stripped;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Slim a single provider tool definition.
 *
 * Produces a new object — the original is never mutated.
 * If the input is not a plain object, it is returned unchanged.
 *
 * @param tool - The tool definition to slim.
 * @param opts - Slim options (descriptionCap).
 * @returns A new, slimmed tool definition.
 */
export function slimTool(tool: ProviderTool, opts: SlimToolOptions = {}): ProviderTool {
  const cap = opts.descriptionCap ?? 1024;
  const out: ProviderTool = { ...tool };

  // Slim description.
  if (typeof out.description === 'string') {
    out.description = truncateAtSentence(out.description, cap);
    if (out.description.length === 0) delete out.description;
  } else if (out.description === null || out.description === undefined) {
    delete out.description;
  }

  // Slim input_schema (Anthropic / MCP shape).
  if (out.input_schema && typeof out.input_schema === 'object') {
    out.input_schema = slimInputSchema(out.input_schema, cap);
  }

  // Slim parameters (OpenAI shape) — same logic.
  if (out.parameters && typeof out.parameters === 'object') {
    out.parameters = slimInputSchema(out.parameters, cap);
  }

  return out;
}

/**
 * Slim an entire tools array from a provider request body.
 *
 * Returns the slimmed tools alongside per-request token savings so the
 * proxy can log them.
 *
 * @param tools - The original tools array from the request body.
 * @param opts - Slim options.
 * @returns `{ slimmedTools, savings }`.
 */
export function slimTools(
  tools: ProviderTool[],
  opts: SlimToolOptions = {},
): { slimmedTools: ProviderTool[]; savings: ToolSlimSavings } {
  const originalJson = JSON.stringify(tools);
  const slimmedTools = tools.map((t) => slimTool(t, opts));
  const slimmedJson = JSON.stringify(slimmedTools);

  const originalTokens = countTokens(originalJson);
  const slimmedTokens = countTokens(slimmedJson);
  const savedTokens = Math.max(0, originalTokens - slimmedTokens);
  const savedPercent = originalTokens > 0
    ? Math.round((savedTokens / originalTokens) * 100)
    : 0;

  return {
    slimmedTools,
    savings: { originalTokens, slimmedTokens, savedTokens, savedPercent },
  };
}

/**
 * Apply slim mode to a parsed provider request body (mutates in place).
 *
 * If the body has no `tools` array, or it is empty, the body is returned
 * unchanged and savings will be zero.
 *
 * @param body - Parsed JSON request body (mutated in place if tools exist).
 * @param opts - Slim options.
 * @returns The savings report; body is mutated.
 */
export function applySlimMode(
  body: Record<string, unknown>,
  opts: SlimToolOptions = {},
): ToolSlimSavings {
  const zero: ToolSlimSavings = {
    originalTokens: 0,
    slimmedTokens: 0,
    savedTokens: 0,
    savedPercent: 0,
  };

  if (!Array.isArray(body['tools']) || (body['tools'] as unknown[]).length === 0) {
    return zero;
  }

  const { slimmedTools, savings } = slimTools(body['tools'] as ProviderTool[], opts);
  body['tools'] = slimmedTools;
  return savings;
}
