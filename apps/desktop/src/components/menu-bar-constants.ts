/**
 * Static catalogue data and shared type aliases used by the menu-bar
 * panel and its sub-components.
 *
 * Split out so {@link MenuBarPanel} stays under the project's 450-LOC
 * cap; nothing here is React-aware.
 */

import type { PaktFormat } from '@sriinnu/pakt';

/** Restore-format options shown in the output card's `<select>`. */
export const OUTPUT_FORMATS: { value: PaktFormat; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'csv', label: 'CSV' },
  { value: 'markdown', label: 'MD' },
  { value: 'text', label: 'Text' },
];

/** Which sub-panel is currently visible (history / settings overlays). */
export type Panel = 'main' | 'settings' | 'history';

/** Primary tabs of the main view — telemetry HQ is the default on open. */
export type MainTab = 'telemetry' | 'compress';

/** Tab metadata for the toolbar's segmented tablist. */
export const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'compress', label: 'Compress' },
];

/** Kind of transform last performed; drives the active-output copy. */
export type TransformAction = 'compress' | 'decompress' | null;

/** Duration of the panel's "open" pulse animation. */
export const MENU_BAR_OPEN_DURATION_MS = 220;

/** How long the copy-success / copy-error chip stays visible. */
export const COPY_STATE_RESET_MS = 1500;
