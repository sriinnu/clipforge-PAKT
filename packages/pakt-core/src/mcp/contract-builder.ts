/**
 * @module mcp/contract-builder
 * Schema construction primitives for MCP tool contracts.
 *
 * Split out of `contract.ts` to keep that file focused on the four
 * tool definitions. This module owns:
 *  - shared enum constants (PII modes, auto actions, recommended actions)
 *  - field spec types (FieldSpec union, FieldMap, JsonObjectSchema)
 *  - the `PaktMcpContract` interface
 *  - the `defineToolContract` factory + its zod/JSON-schema helpers
 */

import * as z from 'zod/v4';

// ---------------------------------------------------------------------------
// Shared enum constants
// ---------------------------------------------------------------------------

/** Valid `action` values for the `pakt_auto` tool result. */
export const AUTO_ACTION_VALUES = ['compressed', 'decompressed'] as const;

/** Valid `recommendedAction` values for the `pakt_inspect` tool result. */
export const RECOMMENDED_ACTION_VALUES = ['compress', 'decompress', 'leave-as-is'] as const;

/** Valid `piiMode` values across `pakt_compress` / `pakt_auto`. */
export const PII_MODE_VALUES = ['off', 'flag', 'redact'] as const;

/** Valid `dictPlacement` values for `pakt_compress`. */
export const DICT_PLACEMENT_VALUES = ['inline', 'system'] as const;

/** Valid `cacheTarget` values for `pakt_compress` (provider cache_control hints). */
export const CACHE_TARGET_VALUES = ['anthropic', 'bedrock', 'openai', 'google'] as const;

/* `piiKinds` is carried across the wire as a comma-separated string
   (e.g. "email,ipv4") for schema simplicity — the handler layer
   validates each kind before turning it into an array. The canonical
   list lives in `src/pii/detector.ts` (`PIIKind`); we intentionally don't
   re-export it here because a zod enum would force `string` → array
   widening in the inferred result type. */

// ---------------------------------------------------------------------------
// Field spec types
// ---------------------------------------------------------------------------

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

/** Union of all supported MCP field shapes. */
export type FieldSpec = StringFieldSpec | NumberFieldSpec | BooleanFieldSpec;

/** A map of field name → spec; used for tool input/output declarations. */
export type FieldMap = Record<string, FieldSpec>;

/** Property entry inside a JSON-schema object. */
export type JsonSchemaProperty = {
  type: string;
  description: string;
  enum?: readonly string[];
};

/** A JSON-schema object derived from a {@link FieldMap}. */
export type JsonObjectSchema = {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  additionalProperties: false;
};

/** A complete MCP tool contract: metadata + zod + JSON schema for both sides. */
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

// ---------------------------------------------------------------------------
// Schema builders
// ---------------------------------------------------------------------------

/** Convert a readonly enum array to the tuple form `z.enum` requires. */
function enumValuesToTuple(values: readonly string[]): [string, ...string[]] {
  if (values.length === 0) {
    throw new Error('Enum field requires at least one value');
  }
  // biome-ignore lint/style/noNonNullAssertion: length > 0 guaranteed by the check above
  return [values[0]!, ...values.slice(1)];
}

/** Build a zod schema for a single field spec. Applies refinements + optional. */
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

/** Build a strict zod object schema from a field map. */
function buildObjectSchema(fields: FieldMap): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [name, field] of Object.entries(fields)) {
    shape[name] = buildFieldSchema(field);
  }
  return z.object(shape).strict();
}

/** Build a JSON-schema object from a field map, mirroring the zod schema. */
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

/**
 * Define a single tool contract from input/output field maps.
 *
 * Generates the matching zod and JSON-schema objects for both sides
 * automatically — the field-map declaration is the single source of truth.
 *
 * @example
 * ```ts
 * const MY_CONTRACT = defineToolContract({
 *   name: 'pakt_thing',
 *   description: 'Do a thing.',
 *   inputFields: { text: { type: 'string', description: '...' } },
 *   outputFields: { result: { type: 'string', description: '...' } },
 * });
 * ```
 */
export function defineToolContract<Name extends string>(config: {
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
