import { Component, type ReactNode, type ErrorInfo } from 'react';

interface State {
  error: Error | null;
}

/** Catches render errors anywhere below it so a single bug can't blank the
 *  whole app. Currently only React class components can act as error
 *  boundaries — there's no hook equivalent. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[error-boundary]', error, info);
    // Best-effort upload to the server so we can debug renderer crashes after
    // the fact. No await — the boundary still renders synchronously.
    void fetch('/api/crash', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack ?? null,
        componentStack: info.componentStack ?? null,
        url: location.href,
        userAgent: navigator.userAgent,
        ts: Date.now(),
      }),
    }).catch(() => {
      /* offline / cookie expired — nothing to do */
    });
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary">
        <div className="error-boundary-card">
          <h2>Something went wrong</h2>
          <p className="error-boundary-msg">
            local-pilot hit a rendering error. The session is safe; reloading should recover.
          </p>
          <pre className="error-boundary-stack">{String(this.state.error.message)}</pre>
          <div className="modal-actions">
            <button className="btn btn-accent" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
