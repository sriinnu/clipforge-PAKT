/**
 * @module detect/types
 * Shared types used across all format detection sub-modules.
 *
 * The {@link Candidate} interface represents a single detection hypothesis
 * produced by a format-specific detector. The main `detect()` function
 * collects candidates and picks the one with the highest confidence.
 */

import type { DetectionResult } from '../types.js';

// ---------------------------------------------------------------------------
// Internal candidate type shared across all detectors
// ---------------------------------------------------------------------------

/**
 * A detection hypothesis produced by a format-specific detector.
 *
 * @property format     - The detected format label
 * @property confidence - Score in [0, 1]; higher = more certain
 * @property reason     - Human-readable explanation for why this format was chosen
 */
export interface Candidate {
  format: DetectionResult['format'];
  confidence: number;
  reason: string;
}
