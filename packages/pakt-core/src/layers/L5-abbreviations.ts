/**
 * @module layers/L5-abbreviations
 * Curated abbreviation dictionary for L5 content-aware compression.
 *
 * Every entry maps a common English word to its universally understood
 * short form. LLMs parse these abbreviated forms identically to the
 * full word — no semantic loss. Only terms with a clear, unambiguous
 * shortening are included.
 *
 * Rules for inclusion:
 * - The abbreviation must be widely understood by both humans and LLMs
 * - The abbreviation must be shorter by at least 3 characters
 * - No abbreviation should be ambiguous (e.g. "mod" could be module or modification)
 */

// ---------------------------------------------------------------------------
// Abbreviation map: long form → short form
// ---------------------------------------------------------------------------

/**
 * Word → abbreviation pairs. Keys are lowercase.
 * Applied to unquoted scalar values only — never inside quoted strings.
 */
export const ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
  // Software/tech terms (unambiguous, universally understood)
  ['application', 'app'],
  ['configuration', 'config'],
  ['development', 'dev'],
  ['environment', 'env'],
  ['information', 'info'],
  ['description', 'desc'],
  ['repository', 'repo'],
  ['authentication', 'auth'],
  ['administrator', 'admin'],
  ['database', 'db'],
  ['parameter', 'param'],
  ['argument', 'arg'],
  ['directory', 'dir'],
  ['temporary', 'tmp'],
  ['maximum', 'max'],
  ['minimum', 'min'],
  ['reference', 'ref'],
  ['certificate', 'cert'],
  ['specification', 'spec'],
  ['organization', 'org'],
  ['documentation', 'docs'],
  ['dependency', 'dep'],
  ['implementation', 'impl'],
  ['infrastructure', 'infra'],
  ['performance', 'perf'],
  ['production', 'prod'],
  ['laboratory', 'lab'],
  ['executable', 'exec'],
  ['destination', 'dest'],
  ['alternative', 'alt'],
  ['previous', 'prev'],
  ['navigation', 'nav'],
  ['separator', 'sep'],
  ['expression', 'expr'],
  ['notification', 'notif'],
  ['allocation', 'alloc'],
  ['initialize', 'init'],
  ['synchronize', 'sync'],
  ['miscellaneous', 'misc'],
  ['professional', 'pro'],
  ['statistics', 'stats'],
  ['utilities', 'utils'],
  ['preferences', 'prefs'],
  ['properties', 'props'],
  ['attributes', 'attrs'],
  ['operations', 'ops'],
  ['management', 'mgmt'],
  ['generation', 'gen'],
  ['connection', 'conn'],
  ['permission', 'perm'],
  ['transaction', 'txn'],
  ['communication', 'comm'],
  ['distribution', 'dist'],
  ['evaluation', 'eval'],
  ['comparison', 'cmp'],
  ['application/json', 'app/json'],
]);

/**
 * Reverse map: abbreviation → full word (for decompression).
 * Built from ABBREVIATIONS at module load.
 */
export const REVERSE_ABBREVIATIONS: ReadonlyMap<string, string> = new Map(
  [...ABBREVIATIONS.entries()].map(([full, abbr]) => [abbr, full]),
);

/** Minimum word length to consider for abbreviation. */
export const MIN_ABBREV_WORD_LENGTH = 6;

/** Minimum character savings to apply an abbreviation. */
export const MIN_ABBREV_SAVINGS = 3;
