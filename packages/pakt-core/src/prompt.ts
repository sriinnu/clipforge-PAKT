/**
 * @module prompt
 * Ready-to-use LLM system prompt snippet that teaches a model
 * to understand PAKT-compressed data.
 *
 * @example
 * ```ts
 * import { PAKT_SYSTEM_PROMPT, compress } from '@sriinnu/pakt';
 *
 * const messages = [
 *   { role: 'system', content: `You are a helpful assistant.\n\n${PAKT_SYSTEM_PROMPT}` },
 *   { role: 'user', content: compress(data).compressed },
 * ];
 * ```
 */

/**
 * System prompt snippet that teaches an LLM to understand PAKT format.
 *
 * Append this to your system prompt when sending PAKT-compressed data
 * to an LLM. It explains the notation in ~45 tokens with a one-shot example.
 *
 * @example
 * ```ts
 * import { PAKT_SYSTEM_PROMPT, compress } from '@sriinnu/pakt';
 *
 * const messages = [
 *   { role: 'system', content: `You are a helpful assistant.\n\n${PAKT_SYSTEM_PROMPT}` },
 *   { role: 'user', content: compress(data).compressed },
 * ];
 * ```
 */
export const PAKT_SYSTEM_PROMPT = `Data may use PAKT notation: pipe-delimited rows with a header row declaring field names. \`@dict\` defines aliases (\`$a\`, \`$b\`) for repeated values. Example:
@dict
  $a: eng
@end
team[2]{name|role}:
Alice|$a
Bob|$a
Treat PAKT as structured data equivalent to JSON.`;
