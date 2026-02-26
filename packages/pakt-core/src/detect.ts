/**
 * @module detect
 * Re-export barrel for format detection.
 *
 * The actual detection logic lives in `./detect/` sub-modules.
 * This file exists so that existing imports like
 * `import { detect } from './detect.js'` continue to work
 * without any changes to consumers.
 */

export { detect } from './detect/index.js';
export type { Candidate } from './detect/types.js';
