/**
 * Style objects for the Settings panel and its sub-components.
 * Extracted to keep Settings.tsx below the 400-line cap.
 */

/** Outer scroll container for the full settings panel. */
export const containerStyle: React.CSSProperties = {
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  overflowY: 'auto',
  maxHeight: '460px',
};

/** Vertical grouping wrapper for one logical settings section. */
export const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

/** Section header label (uppercase, dimmed). */
export const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--cf-text-dim)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

/** Row containing a label+description on the left and a Toggle on the right. */
export const settingRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 12px',
  backgroundColor: 'var(--cf-surface)',
  borderRadius: 'var(--cf-radius-md)',
  gap: 12,
};

/** Flex column holding the setting title and description. */
export const settingTextStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: 1,
};

/** Primary label text for a setting row. */
export const settingLabelStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--cf-text)',
  fontWeight: 500,
};

/** Secondary description / hint text for a setting row. */
export const settingDescStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--cf-text-dim)',
  lineHeight: 1.4,
};

/** Background track for the segmented control. */
export const segmentedContainerStyle: React.CSSProperties = {
  display: 'flex',
  backgroundColor: 'var(--cf-surface)',
  borderRadius: 'var(--cf-radius-md)',
  padding: 3,
  gap: 2,
};

/** Individual segment button (active state applied inline). */
export const segmentBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: '7px 8px',
  borderRadius: 'var(--cf-radius-sm)',
  border: 'none',
  cursor: 'pointer',
  fontSize: 12,
  transition: 'all 0.2s ease',
  fontFamily: 'var(--cf-font)',
};

/** `<label>` wrapper for a select or number input with a caption above. */
export const selectLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

/** The `<select>` / `<input type="number">` element itself. */
export const selectStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 'var(--cf-radius-md)',
  border: '1px solid var(--cf-border)',
  backgroundColor: 'var(--cf-surface)',
  color: 'var(--cf-text)',
  padding: '9px 10px',
  fontSize: 12,
};

/** Bottom info banner summarising how the current settings take effect. */
export const infoStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--cf-text-dim)',
  padding: '10px 12px',
  backgroundColor: 'var(--cf-surface)',
  borderRadius: 'var(--cf-radius-md)',
  lineHeight: 1.5,
};

/** Outer column wrapper for the font preset list. */
export const fontListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

/** Static portions of the font preset button (border / background set inline). */
export const fontBtnBaseStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '8px 10px',
  borderRadius: 'var(--cf-radius-md)',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'var(--cf-transition)',
};

/** Sub-label showing the monospace preview string. */
export const fontPreviewStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--cf-text-muted)',
  letterSpacing: '-0.2px',
};
