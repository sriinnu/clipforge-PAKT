/**
 * React error boundary component.
 *
 * Catches rendering errors anywhere in its subtree and displays a
 * user-friendly fallback instead of a blank/broken popup.
 * Includes a "Try Again" button that resets the error state.
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/** Props for ErrorBoundary. */
interface ErrorBoundaryProps {
  /** Child components to wrap. */
  children: ReactNode;
}

/** Internal state tracking the caught error. */
interface ErrorBoundaryState {
  /** The error that was thrown, or null if no error. */
  error: Error | null;
}

/**
 * Wraps the popup component tree and catches any unhandled rendering errors.
 * Displays a friendly fallback UI with the error message and a reset button.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ClipForge] UI error caught by ErrorBoundary:', error, info);
  }

  /** Reset error state so the user can retry. */
  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div style={wrapperStyle}>
          <div style={cardStyle}>
            {/* Error icon */}
            <div style={iconCircleStyle}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  stroke="var(--cf-error)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <span style={titleStyle}>Something went wrong</span>
            <span style={messageStyle}>
              {this.state.error.message || 'An unexpected error occurred.'}
            </span>

            <button type="button" style={retryBtnStyle} onClick={this.handleReset}>
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/* -- Style objects -------------------------------------------------------- */

const wrapperStyle: React.CSSProperties = {
  width: 350,
  minHeight: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'var(--cf-bg)',
  fontFamily: 'var(--cf-font)',
  padding: 24,
};
const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  textAlign: 'center',
};
const iconCircleStyle: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: '50%',
  backgroundColor: 'var(--cf-error-glow)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const titleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--cf-text)',
};
const messageStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--cf-text-muted)',
  lineHeight: 1.5,
  maxWidth: 260,
};
const retryBtnStyle: React.CSSProperties = {
  marginTop: 4,
  padding: '8px 20px',
  borderRadius: 'var(--cf-radius-md)',
  border: 'none',
  backgroundColor: 'var(--cf-accent)',
  color: '#fff',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'var(--cf-font)',
  transition: 'all 0.2s ease',
};
