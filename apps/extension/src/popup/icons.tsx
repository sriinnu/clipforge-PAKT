/**
 * SVG icon components used throughout the ClipForge popup UI.
 * Each icon is a minimal, inline SVG for fast rendering with no external deps.
 */

/** Gear/cog icon for the settings button. */
export function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.5 1.5h3l.4 1.8.5.2 1.6-.8 2.1 2.1-.8 1.6.2.5 1.8.4v3l-1.8.4-.2.5.8 1.6-2.1 2.1-1.6-.8-.5.2-.4 1.8h-3l-.4-1.8-.5-.2-1.6.8L1.9 12l.8-1.6-.2-.5L.7 9.5v-3l1.8-.4.2-.5-.8-1.6L4 1.9l1.6.8.5-.2.4-1.2z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/** Downward-left arrow icon representing compression. */
export function CompressIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M11 3L3 11M3 11V5M3 11h6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Upward-right arrow icon representing decompression. */
export function DecompressIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M3 11L11 3M11 3v6M11 3H5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Clipboard/copy icon with overlapping rectangles. */
export function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M10 4V2.5A1.5 1.5 0 008.5 1H2.5A1.5 1.5 0 001 2.5v6A1.5 1.5 0 002.5 10H4"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

/** Checkmark icon for copy-confirmed state. */
export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M3 7l3 3 5-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Left-pointing chevron for the back button. */
export function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M9 2L4 7l5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Animated spinner icon for loading states.
 * Uses a CSS animation (defined in styles.ts CSS_VARS) for rotation.
 */
export function SpinnerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      style={{ animation: 'spin 0.8s linear infinite' }}
    >
      <circle
        cx="7"
        cy="7"
        r="5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray="24"
        strokeDashoffset="8"
        opacity="0.8"
      />
    </svg>
  );
}
