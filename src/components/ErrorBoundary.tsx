import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || 'An unexpected error occurred.' };
  }

  componentDidCatch(error: Error) {
    console.error('KEJMIN OPS ErrorBoundary:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div className="glass sec" style={{ maxWidth: 520, margin: 0 }}>
            <h3>Something went wrong</h3>
            <p className="sub">
              KEJMIN OPS encountered a database or application error. Please reload or sign in again.
            </p>
            <div className="er" style={{ wordBreak: 'break-word' }}>
              {this.state.message}
            </div>
            <div style={{ marginTop: 16 }}>
              <button
                className="btn"
                type="button"
                onClick={() => window.location.reload()}
              >
                Reload application
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
