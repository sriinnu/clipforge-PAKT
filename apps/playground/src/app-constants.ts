/**
 * Static catalogue data and type aliases used across the playground UI.
 *
 * Kept separate from {@link App} so the React component file stays under
 * the project's 450-LOC cap and can be read end-to-end without scrolling
 * past dozens of lines of declarative data.
 *
 * The constants here are intentionally `as const` / `ReadonlyArray` so the
 * UI cannot mutate them at runtime — every consumer treats them as
 * immutable lookup tables.
 */

import type { PaktFormat } from '@sriinnu/pakt';

/** Formats the "Restore as" selector offers when decompressing PAKT input. */
export const DECOMPRESS_FORMATS: PaktFormat[] = ['json', 'yaml', 'csv', 'markdown', 'text'];

/**
 * High-level user action currently driving the output panel.
 *
 * `null` means the panel is in its idle / "Output preview" state, before
 * any compress or decompress run.
 */
export type Action = 'compress' | 'decompress' | null;

/** The two top-level views the playground renders. */
export type ViewMode = 'playground' | 'compare';

/**
 * One model entry in the target-model dropdown. The `tokenizerMatch`
 * flag drives the "(approximate)" label — anything other than `'exact'`
 * is treated as a cl100k_base fallback by the runtime.
 */
type TargetModelCatalogEntry = {
  id: string;
  name: string;
  provider: string;
  tokenizerMatch: 'exact' | 'approximate';
};

/* Target models grouped by provider — exact means the tokenizer family
   matches the provider's own byte-pair vocab; approximate models fall
   back to `cl100k_base` and may drift by a few tokens per prompt.

   Keep the catalog canonical here and derive UI labels from metadata so
   future updates are less likely to drift before this is extracted to a
   shared module used by both playground and extension settings. */
const TARGET_MODEL_CATALOG: ReadonlyArray<TargetModelCatalogEntry> = [
  { id: 'gpt-4o', name: 'gpt-4o', provider: 'OpenAI', tokenizerMatch: 'exact' },
  { id: 'gpt-4o-mini', name: 'gpt-4o-mini', provider: 'OpenAI', tokenizerMatch: 'exact' },
  { id: 'gpt-4', name: 'gpt-4 / gpt-4-turbo', provider: 'OpenAI', tokenizerMatch: 'exact' },
  { id: 'claude-opus', name: 'claude-opus', provider: 'Anthropic', tokenizerMatch: 'approximate' },
  {
    id: 'claude-sonnet',
    name: 'claude-sonnet',
    provider: 'Anthropic',
    tokenizerMatch: 'approximate',
  },
  {
    id: 'claude-haiku',
    name: 'claude-haiku',
    provider: 'Anthropic',
    tokenizerMatch: 'approximate',
  },
  { id: 'llama-3', name: 'llama-3.x', provider: 'Meta', tokenizerMatch: 'approximate' },
];

/**
 * Display-ready model list used by the `<select>` element. Labels are
 * derived from {@link TARGET_MODEL_CATALOG} so any addition there flows
 * through automatically.
 */
export const TARGET_MODELS: ReadonlyArray<{ id: string; label: string }> = TARGET_MODEL_CATALOG.map(
  ({ id, name, provider, tokenizerMatch }) => ({
    id,
    label: `${name} (${provider}, ${tokenizerMatch})`,
  }),
);

/**
 * Caveats / "what to keep in mind" notes shown in the Release Notes card.
 * Order is meaningful: the cards render in source order.
 */
export const RELEASE_NOTES = [
  {
    title: 'Mixed content',
    body: 'Embedded structured blocks restore semantically, but exact original formatting may normalize.',
  },
  {
    title: 'CSV caveat',
    body: 'CSV is not always a win. Some already-compact CSV payloads can get larger.',
  },
  {
    title: 'Auto-pack',
    body: 'Compare Layers benchmarks structure-only, standard, tokenizer-aware, and optional semantic PAKT profiles.',
  },
  {
    title: 'Privacy',
    body: 'The playground runs locally in your browser session. It does not upload payloads anywhere.',
  },
  {
    title: 'Mixed decompress',
    body: 'To unPAKT mixed content, paste the PAKT-marked output back into Input, then run Decompress.',
  },
] as const;

/**
 * Static preview snippets shown in the "Inspect-First Workflow" card.
 *
 * The CLI snippet here is just for display — actual copy uses
 * {@link buildCliWorkflowSnippet} so the user's current Input payload is
 * embedded in a shell-safe way.
 */
export const WORKFLOW_SNIPPET_PREVIEW = {
  cli: ['cat payload.txt | pakt inspect', 'cat payload.txt | pakt auto'].join('\n'),
  mcp: JSON.stringify(
    {
      mcpServers: {
        pakt: {
          command: 'npx',
          args: ['-y', '@sriinnu/pakt', 'serve', '--stdio'],
        },
      },
    },
    null,
    2,
  ),
} as const;
