import React from 'react';

type State = { hasError: boolean; error?: Error };

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('App crash caught by ErrorBoundary', error, errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, position: 'relative', zIndex: 1 }}>
        <div className="glass-strong" style={{ width: 'min(100%, 520px)', borderRadius: 24, padding: 28 }}>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.04em' }}>Something crashed</div>
          <div style={{ marginTop: 10, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            A component blew up, but the whole app didn’t have to die with it.
          </div>
          {this.state.error?.message && (
            <pre style={{ marginTop: 18, padding: 16, borderRadius: 16, overflowX: 'auto', background: 'rgba(15,17,23,0.9)', color: '#D7DBE7', fontSize: 12 }}>
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 18,
              border: 'none',
              borderRadius: 12,
              padding: '12px 16px',
              fontWeight: 700,
              cursor: 'pointer',
              background: 'linear-gradient(135deg, #00E6A8, #00C494)',
              color: '#fff',
            }}
          >
            Reload app
          </button>
        </div>
      </div>
    );
  }
}
