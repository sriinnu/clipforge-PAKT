/**
 * @module mcp/contract
 * Canonical MCP tool contract definitions for PAKT.
 *
 * This is the single source of truth for tool names, descriptions, field
 * metadata, and SDK validation schemas. Public JSON-style tool definitions,
 * TypeScript types, and SDK registration all derive from these contracts.
 */

import * as z from 'zod/v4';
import { PAKT_FORMAT_VALUES } from '../formats.js';
const AUTO_ACTION_VALUES = ['compressed', 'decompressed'] as const;
const RECOMMENDED_ACTION_VALUES = ['compress', 'decompress', 'leave-as-is'] as const;
const PII_MODE_VALUES = ['off', 'flag', 'redact'] as const;
/* `piiKinds` is carried across the wire as a comma-separated string
   (e.g. "email,ipv4") for schema simplicity — the handler layer
   validates each kind before turning it into an array. The canonical
   list lives in `src/pii/detector.ts` (`PIIKind`); we intentionally don't
   re-export it here because a zod enum would force `string` → array
   widening in the inferred result type. */

type BaseFieldSpec = {
  description: string;
  required?: boolean;
};

type StringFieldSpec = BaseFieldSpec & {
  type: 'string';
  enum?: readonly string[];
  minLength?: number;
  minLengthMessage?: string;
};

type NumberFieldSpec = BaseFieldSpec & {
  type: 'number';
  integer?: boolean;
  positive?: boolean;
  positiveMessage?: string;
};

type BooleanFieldSpec = BaseFieldSpec & {
  type: 'boolean';
};

type FieldSpec = StringFieldSpec | NumberFieldSpec | BooleanFieldSpec;
type FieldMap = Record<string, FieldSpec>;

type JsonSchemaProperty = {
  type: string;
  description: string;
  enum?: readonly string[];
};

type JsonObjectSchema = {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  additionalProperties: false;
};

export interface PaktMcpContract<Name extends string = string> {
  name: Name;
  description: string;
  inputFields: FieldMap;
  outputFields: FieldMap;
  inputJsonSchema: JsonObjectSchema;
  outputJsonSchema: JsonObjectSchema;
  inputSchema: z.ZodObject<Record<string, z.ZodType>>;
  outputSchema: z.ZodObject<Record<string, z.ZodType>>;
}

function enumValuesToTuple(values: readonly string[]): [string, ...string[]] {
  if (values.length === 0) {
    throw new Error('Enum field requires at least one value');
  }
  // biome-ignore lint/style/noNonNullAssertion: length > 0 guaranteed by the check above
  return [values[0]!, ...values.slice(1)];
}

function buildFieldSchema(field: FieldSpec): z.ZodType {
  switch (field.type) {
    case 'string': {
      let schema: z.ZodType = field.enum ? z.enum(enumValuesToTuple(field.enum)) : z.string();
      if (field.minLength !== undefined) {
        schema = (schema as z.ZodString).min(field.minLength, field.minLengthMessage);
      }
      schema = schema.describe(field.description);
      return field.required === false ? schema.optional() : schema;
    }
    case 'number': {
      let schema: z.ZodType = z.number();
      if (field.integer) {
        schema = (schema as z.ZodNumber).int();
      }
      if (field.positive) {
        schema = (schema as z.ZodNumber).positive(field.positiveMessage);
      }
      schema = schema.describe(field.description);
      return field.required === false ? schema.optional() : schema;
    }
    case 'boolean': {
      const schema = z.boolean().describe(field.description);
      return field.required === false ? schema.optional() : schema;
    }
  }
}

function buildObjectSchema(fields: FieldMap): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [name, field] of Object.entries(fields)) {
    shape[name] = buildFieldSchema(field);
  }
  return z.object(shape).strict();
}

function buildJsonObjectSchema(fields: FieldMap): JsonObjectSchema {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const [name, field] of Object.entries(fields)) {
    properties[name] = {
      type: field.type,
      description: field.description,
      ...(field.type === 'string' && field.enum ? { enum: field.enum } : {}),
    };

    if (field.required !== false) {
      required.push(name);
    }
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function defineToolContract<Name extends string>(config: {
  name: Name;
  description: string;
  inputFields: FieldMap;
  outputFields: FieldMap;
}): PaktMcpContract<Name> {
  return {
    ...config,
    inputJsonSchema: buildJsonObjectSchema(config.inputFields),
    outputJsonSchema: buildJsonObjectSchema(config.outputFields),
    inputSchema: buildObjectSchema(config.inputFields),
    outputSchema: buildObjectSchema(config.outputFields),
  };
}

export const PAKT_COMPRESS_CONTRACT = defineToolContract({
  name: 'pakt_compress',
  description: [
    'Compress text into PAKT format for LLM token optimization.',
    'Supports JSON, YAML, CSV, Markdown, and mixed content.',
    'Returns the compressed string and savings percentage.',
    'Use the optional `format` parameter to skip auto-detection.',
    'Use `semanticBudget` to opt into lossy L4 semantic compression.',
    'Use `piiMode` to flag or redact sensitive strings in the output.',
  ].join(' '),
  inputFields: {
    text: {
      type: 'string',
      description: 'The text content to compress (JSON, YAML, CSV, Markdown, or mixed).',
      minLength: 1,
      minLengthMessage: 'text must be a non-empty string',
    },
    format: {
      type: 'string',
      description: 'Optional format hint. Valid values: json, yaml, csv, markdown, text, pakt.',
      enum: PAKT_FORMAT_VALUES,
      required: false,
    },
    semanticBudget: {
      type: 'number',
      description: 'Optional positive token budget for opt-in lossy L4 semantic compression.',
      integer: true,
      positive: true,
      positiveMessage: 'semanticBudget must be a positive integer',
      required: false,
    },
    piiMode: {
      type: 'string',
      description:
        'PII strategy: off (default), flag (inject @warning pii header), or redact (replace values with placeholders; marks result non-reversible).',
      enum: PII_MODE_VALUES,
      required: false,
    },
    piiKinds: {
      type: 'string',
      description:
        'Optional comma-separated PII kinds to scan for. Valid: email,phone,ipv4,ipv6,jwt,aws-access-key,aws-secret-key,credit-card,ssn. Omit to scan all.',
      required: false,
    },
    piiReversible: {
      type: 'boolean',
      description:
        'When true and piiMode is redact, return a placeholder → original mapping in piiMapping.',
      required: false,
    },
  },
  outputFields: {
    compressed: {
      type: 'string',
      description: 'The compressed PAKT string.',
    },
    savings: {
      type: 'number',
      description: 'Savings percentage (0-100).',
    },
    format: {
      type: 'string',
      description: 'The detected or specified input format.',
      enum: PAKT_FORMAT_VALUES,
    },
    originalTokens: {
      type: 'number',
      description: 'Token count for the original input.',
    },
    compressedTokens: {
      type: 'number',
      description: 'Token count for the compressed output.',
    },
    savedTokens: {
      type: 'number',
      description: 'Absolute tokens saved.',
    },
    reversible: {
      type: 'boolean',
      description: 'Whether the compressed representation preserves all information.',
    },
    piiCounts: {
      type: 'string',
      description:
        'JSON object string: per-kind match counts when PII was detected; omitted otherwise.',
      required: false,
    },
    piiMapping: {
      type: 'string',
      description:
        'JSON object string: placeholder → original mapping for reversible redact mode; omitted otherwise.',
      required: false,
    },
  },
});

export const PAKT_AUTO_CONTRACT = defineToolContract({
  name: 'pakt_auto',
  description: [
    'Compress data to save tokens in conversation context. Use this tool for ANY structured data',
    '(JSON, YAML, CSV) or text blocks over 50 tokens before including them in responses.',
    'Each compression saves tokens on every subsequent turn because the compact form stays in context.',
    'If input is already PAKT-compressed, decompresses it. Inputs under 50 tokens are returned unchanged.',
    'Supports all formats: JSON, YAML, CSV, Markdown, logs, config files, API responses, plain text.',
  ].join(' '),
  inputFields: {
    text: {
      type: 'string',
      description: 'The text to process. PAKT input is decompressed; raw input is compressed.',
      minLength: 1,
      minLengthMessage: 'text must be a non-empty string',
    },
    semanticBudget: {
      type: 'number',
      description: 'Optional positive token budget for opt-in lossy L4 semantic compression.',
      integer: true,
      positive: true,
      positiveMessage: 'semanticBudget must be a positive integer',
      required: false,
    },
    piiMode: {
      type: 'string',
      description:
        'PII strategy applied to compressed output: off (default), flag, or redact. Ignored when decompressing.',
      enum: PII_MODE_VALUES,
      required: false,
    },
    piiKinds: {
      type: 'string',
      description:
        'Optional comma-separated PII kinds. Valid: email,phone,ipv4,ipv6,jwt,aws-access-key,aws-secret-key,credit-card,ssn.',
      required: false,
    },
    piiReversible: {
      type: 'boolean',
      description:
        'When true and piiMode is redact, return a placeholder → original mapping in piiMapping.',
      required: false,
    },
  },
  outputFields: {
    result: {
      type: 'string',
      description: 'The processed text (compressed PAKT or decompressed original).',
    },
    action: {
      type: 'string',
      description: 'Whether the input was compressed or decompressed.',
      enum: AUTO_ACTION_VALUES,
    },
    savings: {
      type: 'number',
      description: 'Savings percentage (only present when action is compressed).',
      required: false,
    },
    detectedFormat: {
      type: 'string',
      description: 'Detected format before the action was applied.',
      enum: PAKT_FORMAT_VALUES,
    },
    originalFormat: {
      type: 'string',
      description: 'Original structured format declared by PAKT, when decompressing.',
      enum: PAKT_FORMAT_VALUES,
      required: false,
    },
    inputTokens: {
      type: 'number',
      description: 'Token count of the input before processing.',
      required: false,
    },
    outputTokens: {
      type: 'number',
      description: 'Token count of the output after processing.',
      required: false,
    },
    savedTokens: {
      type: 'number',
      description: 'Absolute tokens saved.',
      required: false,
    },
    reversible: {
      type: 'boolean',
      description: 'Whether the resulting content is reversible without information loss.',
      required: false,
    },
    wasLossy: {
      type: 'boolean',
      description: 'Whether decompressed PAKT carried lossy L4 content.',
      required: false,
    },
    dedupHit: {
      type: 'boolean',
      description:
        'True when the result was served from the dedup cache (no re-compression needed).',
      required: false,
    },
    belowThreshold: {
      type: 'boolean',
      description:
        'True when the input was below the minimum token threshold and returned unchanged.',
      required: false,
    },
    piiCounts: {
      type: 'string',
      description:
        'JSON object string: per-kind match counts when PII was detected; omitted otherwise.',
      required: false,
    },
    piiMapping: {
      type: 'string',
      description:
        'JSON object string: placeholder → original mapping for reversible redact mode; omitted otherwise.',
      required: false,
    },
  },
});

export const PAKT_INSPECT_CONTRACT = defineToolContract({
  name: 'pakt_inspect',
  description: [
    'Inspect text before using PAKT.',
    'Detects the format, counts tokens, estimates compression savings,',
    'and recommends whether to compress, decompress, or leave the content as-is.',
  ].join(' '),
  inputFields: {
    text: {
      type: 'string',
      description: 'The text to inspect.',
      minLength: 1,
      minLengthMessage: 'text must be a non-empty string',
    },
    model: {
      type: 'string',
      description: 'Optional model identifier used for token counting.',
      minLength: 1,
      required: false,
    },
    semanticBudget: {
      type: 'number',
      description: 'Optional positive token budget to estimate lossy L4 compression.',
      integer: true,
      positive: true,
      positiveMessage: 'semanticBudget must be a positive integer',
      required: false,
    },
  },
  outputFields: {
    detectedFormat: {
      type: 'string',
      description: 'Detected format for the inspected input.',
      enum: PAKT_FORMAT_VALUES,
    },
    confidence: {
      type: 'number',
      description: 'Confidence from the format detector.',
    },
    reason: {
      type: 'string',
      description: 'Human-readable detection reason.',
    },
    inputTokens: {
      type: 'number',
      description: 'Token count for the current input.',
    },
    recommendedAction: {
      type: 'string',
      description: 'Suggested next action for an MCP client.',
      enum: RECOMMENDED_ACTION_VALUES,
    },
    estimatedOutputTokens: {
      type: 'number',
      description: 'Token count after estimated compression, when relevant.',
      required: false,
    },
    estimatedSavings: {
      type: 'number',
      description: 'Estimated savings percentage after compression, when relevant.',
      required: false,
    },
    estimatedSavedTokens: {
      type: 'number',
      description: 'Estimated absolute tokens saved, when relevant.',
      required: false,
    },
    reversible: {
      type: 'boolean',
      description: 'Reversibility of the current or estimated representation.',
      required: false,
    },
    originalFormat: {
      type: 'string',
      description: 'Original structured format declared by PAKT, when inspecting PAKT input.',
      enum: PAKT_FORMAT_VALUES,
      required: false,
    },
    wasLossy: {
      type: 'boolean',
      description: 'Whether the inspected PAKT payload is lossy, when known.',
      required: false,
    },
  },
});

export const PAKT_STATS_CONTRACT = defineToolContract({
  name: 'pakt_stats',
  description: [
    'Return session-level compression statistics including compounding context savings.',
    'Shows total calls, token savings, format breakdown, cost estimates,',
    'dedup cache efficiency, and cumulative tokens saved across conversation turns.',
  ].join(' '),
  inputFields: {
    model: {
      type: 'string',
      description: 'Optional model identifier for cost estimation (default: gpt-4o).',
      minLength: 1,
      required: false,
    },
    scope: {
      type: 'string',
      description:
        'Stats scope: "session" (current process, fast, default) or "all" (persistent stats across all agents, reads disk).',
      enum: ['session', 'all'] as const,
      required: false,
    },
  },
  outputFields: {
    sessionDuration: {
      type: 'string',
      description: 'Human-readable session duration (e.g., "14m 32s").',
    },
    totalCalls: {
      type: 'number',
      description: 'Total number of tool calls in this session.',
    },
    totalInputTokens: {
      type: 'number',
      description: 'Total input tokens processed across all calls.',
    },
    totalOutputTokens: {
      type: 'number',
      description: 'Total output tokens produced across all calls.',
    },
    totalSavedTokens: {
      type: 'number',
      description: 'Total tokens saved across all calls.',
    },
    overallSavingsPercent: {
      type: 'number',
      description: 'Weighted overall savings percentage (0-100).',
    },
    callsByAction: {
      type: 'string',
      description: 'JSON object: { compress, decompress, inspect } call counts.',
    },
    byFormat: {
      type: 'string',
      description: 'JSON object: per-format breakdown with calls, tokens, and savings.',
    },
    topFormat: {
      type: 'string',
      description:
        'JSON object string: format with most calls and its avg savings; omitted when unavailable.',
      required: false,
    },
    estimatedCostSaved: {
      type: 'string',
      description:
        'JSON object string: { input, output, currency } cost savings estimate; omitted when unavailable.',
      required: false,
    },
    lastCallAt: {
      type: 'string',
      description:
        'ISO 8601 timestamp string of the most recent tool call; omitted when unavailable.',
      required: false,
    },
    dedupHits: {
      type: 'number',
      description: 'Total dedup cache hits (compression pipeline runs avoided).',
      required: false,
    },
    dedupEntries: {
      type: 'number',
      description: 'Total entries in the dedup cache.',
      required: false,
    },
    totalCompoundingSavings: {
      type: 'number',
      description:
        'Estimated total tokens saved by serving cached results instead of recompressing.',
      required: false,
    },
  },
});

export const PAKT_MCP_CONTRACTS = [
  PAKT_COMPRESS_CONTRACT,
  PAKT_AUTO_CONTRACT,
  PAKT_INSPECT_CONTRACT,
  PAKT_STATS_CONTRACT,
] as const;

export type PaktContractToolName = (typeof PAKT_MCP_CONTRACTS)[number]['name'];
export type PaktCompressArgsFromContract = z.infer<typeof PAKT_COMPRESS_CONTRACT.inputSchema>;
export type PaktCompressResultFromContract = z.infer<typeof PAKT_COMPRESS_CONTRACT.outputSchema>;
export type PaktAutoArgsFromContract = z.infer<typeof PAKT_AUTO_CONTRACT.inputSchema>;
export type PaktAutoResultFromContract = z.infer<typeof PAKT_AUTO_CONTRACT.outputSchema>;
export type PaktInspectArgsFromContract = z.infer<typeof PAKT_INSPECT_CONTRACT.inputSchema>;
export type PaktInspectResultFromContract = z.infer<typeof PAKT_INSPECT_CONTRACT.outputSchema>;
export type PaktStatsArgsFromContract = z.infer<typeof PAKT_STATS_CONTRACT.inputSchema>;
export type PaktStatsResultFromContract = z.infer<typeof PAKT_STATS_CONTRACT.outputSchema>;
