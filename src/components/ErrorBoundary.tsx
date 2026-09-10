/** Top-level error boundary: a runtime error renders a recoverable screen with a
 *  reload action instead of a blank white page. Keeps the app usable after a crash. */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '@/lib/analytics';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Errors are reported to Sentry only when a DSN is configured (owner action,
    // roadmap decision D8); with no DSN this is a no-op and the console is the only
    // record. The component stack is truncated because oversized context gets dropped.
    reportError(error, { componentStack: info.componentStack?.slice(0, 500) });
    if (import.meta.env.DEV) console.error('App crashed:', error, info);
    // production: also surface to the console for support. Note the error message is
    // whatever the throwing code put there, so it can carry user data either way.
    else console.error('App error:', error.message);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>
              The page hit an unexpected error. Reloading usually fixes it.
            </p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              style={{ padding: '8px 16px', borderRadius: 8, background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14 }}
            >
              Reload
            </button>
            {import.meta.env.DEV && (
              <pre style={{ marginTop: 16, textAlign: 'left', fontSize: 11, color: '#b91c1c', whiteSpace: 'pre-wrap' }}>
                {this.state.error.message}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
