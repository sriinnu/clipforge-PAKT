import type { PaktFormat } from './types.js';

const INTERNAL_PAKT_FORMAT_VALUES = [
  'json',
  'yaml',
  'csv',
  'markdown',
  'text',
  'pakt',
] as const satisfies readonly PaktFormat[];

export const PAKT_FORMAT_VALUES = Object.freeze([
  ...INTERNAL_PAKT_FORMAT_VALUES,
]) as readonly PaktFormat[];

const PAKT_FORMAT_SET = new Set<PaktFormat>(INTERNAL_PAKT_FORMAT_VALUES);

export function isPaktFormat(value: unknown): value is PaktFormat {
  return typeof value === 'string' && PAKT_FORMAT_SET.has(value as PaktFormat);
}
