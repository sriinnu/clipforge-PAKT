/**
 * Full-tab Options page shell.
 *
 * Reuses the popup\u2019s `<Settings>` component to avoid divergent settings
 * surfaces. The options page only adds chrome \u2014 a centered card, page title,
 * and a footer pointing back to the docs.
 */

import { Settings } from '../popup/Settings';
import { useTheme } from '../popup/useTheme';

const VERSION = typeof __CLIPFORGE_VERSION__ === 'string' ? __CLIPFORGE_VERSION__ : 'dev';

export function OptionsApp() {
  // `useTheme` handles bundled-font loading + theme class + font preset.
  // The options page reuses it verbatim so it stays in sync with the popup.
  useTheme();

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={titleStyle}>ClipForge Settings</h1>
        <span style={versionStyle}>v{VERSION}</span>
      </header>
      <main style={cardStyle}>
        <Settings onBack={() => window.close()} />
      </main>
      <footer style={footerStyle}>
        <a href="https://github.com/sriinnu/Kaala-brahma" target="_blank" rel="noreferrer">
          ClipForge \u00b7 PAKT format
        </a>
      </footer>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'var(--cf-bg, #0f0d1a)',
  color: 'var(--cf-text, #e8e6f0)',
  fontFamily: 'var(--cf-font)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '32px 16px 64px',
};

const headerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 640,
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  marginBottom: 20,
};

const titleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 600,
  margin: 0,
};

const versionStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--cf-text-dim, #8d88a3)',
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 640,
  background: 'var(--cf-bg-elevated, #16142a)',
  borderRadius: 'var(--cf-radius-lg, 14px)',
  border: '1px solid var(--cf-border, #2a2740)',
  overflow: 'hidden',
};

const footerStyle: React.CSSProperties = {
  marginTop: 24,
  fontSize: 11,
  color: 'var(--cf-text-dim, #8d88a3)',
};
