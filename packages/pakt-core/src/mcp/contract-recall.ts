/**
 * @module mcp/contract-recall
 * Contract for `pakt_recall`: fetch the full text of a tool result that was
 * spilled at append time (see `spill/index.ts`).
 */

import type * as z from 'zod/v4';
import { defineToolContract } from './contract-builder.js';

export const PAKT_RECALL_CONTRACT = defineToolContract({
  name: 'pakt_recall',
  description: [
    'Fetch the full text of a large tool result that PAKT replaced with a short gist.',
    'Use it when a message ends with "[pakt spilled sp_…: … Full text: pakt_recall {"id":"sp_…"}]"',
    'and the shown lines are not enough. Optional startLine/endLine (1-based, inclusive)',
    'return just a slice, which keeps the recall itself small.',
  ].join(' '),
  inputFields: {
    id: {
      type: 'string',
      description: 'Spill id from the gist, e.g. sp_0123456789abcdef.',
      minLength: 1,
      minLengthMessage: 'id must be a non-empty string',
    },
    startLine: {
      type: 'number',
      description: 'First line to return (1-based). Defaults to 1.',
      integer: true,
      positive: true,
      positiveMessage: 'startLine must be a positive integer',
      required: false,
    },
    endLine: {
      type: 'number',
      description: 'Last line to return (inclusive). Defaults to the last line.',
      integer: true,
      positive: true,
      positiveMessage: 'endLine must be a positive integer',
      required: false,
    },
  },
  outputFields: {
    id: { type: 'string', description: 'The requested spill id.' },
    found: { type: 'boolean', description: 'Whether the id exists in the spill store.' },
    text: { type: 'string', description: 'The recalled text (or the requested slice).' },
    totalLines: { type: 'number', description: 'Line count of the full spilled text.' },
    startLine: { type: 'number', description: 'First line returned.' },
    endLine: { type: 'number', description: 'Last line returned.' },
  },
});

export type PaktRecallArgsFromContract = z.infer<typeof PAKT_RECALL_CONTRACT.inputSchema>;
export type PaktRecallResultFromContract = z.infer<typeof PAKT_RECALL_CONTRACT.outputSchema>;
