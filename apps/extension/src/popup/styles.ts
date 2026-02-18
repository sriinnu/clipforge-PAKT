/**
 * CSS custom properties and shared style objects for the ClipForge popup.
 * Dark theme is default. Light via `.theme-light`, system via media query.
 */

/** Global CSS injected once into the <head> element. */
export const CSS_VARS = `
  :root {
    --cf-bg: #0f0d1a;
    --cf-surface: #1a1730;
    --cf-surface-hover: #241f3a;
    --cf-accent: #7c3aed;
    --cf-accent-hover: #6d28d9;
    --cf-accent-glow: rgba(124, 58, 237, 0.15);
    --cf-success: #22c55e;
    --cf-success-glow: rgba(34, 197, 94, 0.15);
    --cf-error: #ef4444;
    --cf-error-glow: rgba(239, 68, 68, 0.15);
    --cf-text: #e8e6f0;
    --cf-text-muted: #8b85a0;
    --cf-text-dim: #5e586f;
    --cf-border: #2a2545;
    --cf-border-focus: #7c3aed;
    --cf-radius-lg: 12px;
    --cf-radius-md: 8px;
    --cf-radius-sm: 6px;
    --cf-radius-pill: 100px;
    --cf-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    --cf-font-mono: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
    --cf-transition: 0.2s ease;
  }
  /* Light theme overrides */
  .theme-light {
    --cf-bg: #f8f7fc;
    --cf-surface: #ffffff;
    --cf-surface-hover: #f0eef5;
    --cf-accent: #7c3aed;
    --cf-accent-hover: #6d28d9;
    --cf-accent-glow: rgba(124, 58, 237, 0.08);
    --cf-success: #16a34a;
    --cf-success-glow: rgba(22, 163, 74, 0.08);
    --cf-error: #dc2626;
    --cf-error-glow: rgba(220, 38, 38, 0.08);
    --cf-text: #1e1b2e;
    --cf-text-muted: #6b6580;
    --cf-text-dim: #9590a8;
    --cf-border: #e0dce8;
    --cf-border-focus: #7c3aed;
  }
  /* System theme — auto-switch light when OS is light */
  @media (prefers-color-scheme: light) {
    .theme-system {
      --cf-bg: #f8f7fc;
      --cf-surface: #ffffff;
      --cf-surface-hover: #f0eef5;
      --cf-accent: #7c3aed;
      --cf-accent-hover: #6d28d9;
      --cf-accent-glow: rgba(124, 58, 237, 0.08);
      --cf-success: #16a34a;
      --cf-success-glow: rgba(22, 163, 74, 0.08);
      --cf-error: #dc2626;
      --cf-error-glow: rgba(220, 38, 38, 0.08);
      --cf-text: #1e1b2e;
      --cf-text-muted: #6b6580;
      --cf-text-dim: #9590a8;
      --cf-border: #e0dce8;
      --cf-border-focus: #7c3aed;
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 350px;
    max-height: 500px;
    overflow-y: auto;
    background: var(--cf-bg);
    color: var(--cf-text);
    font-family: var(--cf-font);
    font-size: 13px;
    line-height: 1.4;
    -webkit-font-smoothing: antialiased;
  }
  body::-webkit-scrollbar { width: 4px; }
  body::-webkit-scrollbar-track { background: transparent; }
  body::-webkit-scrollbar-thumb { background: var(--cf-border); border-radius: 2px; }
  textarea {
    font-family: var(--cf-font-mono);
    font-size: 12px;
    line-height: 1.6;
  }
  textarea::-webkit-scrollbar { width: 4px; }
  textarea::-webkit-scrollbar-track { background: transparent; }
  textarea::-webkit-scrollbar-thumb { background: var(--cf-border); border-radius: 2px; }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes slideIn {
    from { opacity: 0; transform: translateX(8px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes slideInFromRight {
    from { opacity: 0; transform: translateX(20px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes slideOutToRight {
    from { opacity: 1; transform: translateX(0); }
    to   { opacity: 0; transform: translateX(20px); }
  }
  @keyframes copyFlash {
    0%   { background-color: var(--cf-accent); }
    50%  { background-color: var(--cf-success); }
    100% { background-color: var(--cf-success); }
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @keyframes shimmer {
    0%   { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  @keyframes notificationSlide {
    0%   { opacity: 0; transform: translateY(-8px); }
    10%  { opacity: 1; transform: translateY(0); }
    90%  { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(-8px); }
  }
`;

/** Background tint colors for each detected format badge. */
export const FORMAT_COLORS: Record<string, string> = {
  json: '#f59e0b', yaml: '#3b82f6', csv: '#10b981',
  markdown: '#8b5cf6', pakt: '#7c3aed', text: '#6b7280',
};

/** Human-readable labels for each format. */
export const FORMAT_LABELS: Record<string, string> = {
  json: 'JSON', yaml: 'YAML', csv: 'CSV',
  markdown: 'Markdown', pakt: 'PAKT', text: 'Plain Text',
};

/** Tooltip descriptions explaining what the detected format means. */
export const FORMAT_TOOLTIPS: Record<string, string> = {
  json: 'Detected JSON structure \u2014 keys, nesting, and arrays will be compressed',
  yaml: 'Detected YAML config \u2014 indentation and keys will be compressed',
  csv: 'Detected CSV tabular data \u2014 headers and repeated values will be compressed',
  markdown: 'Detected Markdown \u2014 headings, lists, and formatting will be compressed',
  pakt: 'Already in PAKT compressed format \u2014 select a target format to decompress',
  text: 'Plain text \u2014 minimal structural compression available',
};

/** Outermost wrapper for the popup. */
export const containerStyle: React.CSSProperties = {
  width: 350, maxHeight: 500, display: 'flex', flexDirection: 'column',
  backgroundColor: 'var(--cf-bg)', color: 'var(--cf-text)',
  fontFamily: 'var(--cf-font)', fontSize: 13, overflow: 'hidden',
};
/** Top header bar with logo and settings gear. */
export const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 14px', borderBottom: '1px solid var(--cf-border)', flexShrink: 0,
};
/** ClipForge logo text. */
export const logoStyle: React.CSSProperties = {
  fontSize: 15, fontWeight: 700, color: 'var(--cf-accent)', letterSpacing: -0.3,
};
/** Version badge next to the logo. */
export const versionBadgeStyle: React.CSSProperties = {
  fontSize: 10, color: 'var(--cf-text-dim)', backgroundColor: 'var(--cf-surface)',
  padding: '1px 6px', borderRadius: 'var(--cf-radius-pill)', fontWeight: 500,
};
/** Gear icon button in the header. */
export const gearBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--cf-text-muted)', cursor: 'pointer',
  padding: 4, borderRadius: 'var(--cf-radius-sm)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', transition: 'color var(--cf-transition)',
};
/** Back arrow button (settings header). */
export const backBtnStyle: React.CSSProperties = { ...gearBtnStyle, padding: 2 };
/** Main body content area (scrollable). */
export const bodyStyle: React.CSSProperties = {
  padding: '12px 14px', display: 'flex', flexDirection: 'column',
  gap: 10, flex: 1, overflowY: 'auto',
};
/** Top bar holding format badge and clear button. */
export const topBarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};
/** Format detection pill badge. */
export const formatBadgeStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px',
  borderRadius: 'var(--cf-radius-pill)', fontSize: 11, fontWeight: 600,
  border: '1px solid', letterSpacing: 0.2, cursor: 'help',
};
/** Clear / reset button. */
export const clearBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--cf-text-dim)', cursor: 'pointer',
  fontSize: 11, fontWeight: 500, padding: '2px 6px',
  borderRadius: 'var(--cf-radius-sm)', transition: 'color var(--cf-transition)',
};
/** Monospace textarea for input/output. */
export const textareaStyle: React.CSSProperties = {
  width: '100%', minHeight: 100, padding: '10px 12px',
  backgroundColor: 'var(--cf-surface)', color: 'var(--cf-text)',
  border: '1px solid var(--cf-border)', borderRadius: 'var(--cf-radius-md)',
  resize: 'vertical', fontFamily: 'var(--cf-font-mono)', fontSize: 12,
  lineHeight: 1.6, outline: 'none', boxSizing: 'border-box',
  transition: 'border-color var(--cf-transition)',
};
/** Primary action button (Compress). */
export const primaryBtnStyle: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 6, padding: '9px 16px', borderRadius: 'var(--cf-radius-md)',
  border: 'none', backgroundColor: 'var(--cf-accent)', color: '#fff',
  fontWeight: 600, fontSize: 13, cursor: 'pointer',
  transition: 'all var(--cf-transition)', fontFamily: 'var(--cf-font)',
};
/** Secondary action button (Decompress). */
export const secondaryBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle, backgroundColor: 'var(--cf-surface)',
  border: '1px solid var(--cf-border)',
};
/** Dropdown select for decompress format. */
export const selectStyle: React.CSSProperties = {
  padding: '8px 10px', backgroundColor: 'var(--cf-surface)', color: 'var(--cf-text)',
  border: '1px solid var(--cf-border)', borderRadius: 'var(--cf-radius-md)',
  fontSize: 12, outline: 'none', fontFamily: 'var(--cf-font)', cursor: 'pointer',
};
/** Copy result button. */
export const copyBtnStyle: React.CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 6, padding: '9px 16px', borderRadius: 'var(--cf-radius-md)',
  border: 'none', color: '#fff', fontWeight: 600, fontSize: 13,
  cursor: 'pointer', transition: 'background-color 0.3s ease', fontFamily: 'var(--cf-font)',
};
/** Output section label. */
export const outputLabelStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--cf-text-dim)', textTransform: 'uppercase',
  fontWeight: 600, letterSpacing: 0.5,
};
/** Status message (success/error toast). */
export const statusMsgStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 'var(--cf-radius-md)',
  fontSize: 12, fontWeight: 500, animation: 'fadeIn 0.2s ease',
};
/** Bottom footer bar. */
export const footerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 14px', borderTop: '1px solid var(--cf-border)', flexShrink: 0,
};
/** Footer link style. */
export const footerLinkStyle: React.CSSProperties = {
  color: 'var(--cf-text-dim)', fontSize: 11, textDecoration: 'none',
  fontWeight: 500, transition: 'color var(--cf-transition)',
};
