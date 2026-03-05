/**
 * @module packer
 * Context window packer — barrel export.
 *
 * Re-exports the core {@link pack} function and all associated types
 * from the packer sub-module.
 */

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

export { pack } from './packer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  PackerItem,
  PackerOptions,
  PackerResult,
  PackedItem,
  DroppedItem,
  PackerStats,
} from './types.js';
