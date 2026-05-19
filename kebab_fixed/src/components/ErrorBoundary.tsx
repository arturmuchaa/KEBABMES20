/**
 * ErrorBoundary — łapie React errors i pokazuje fallback zamiast białej strony.
 * Loguje też do localStorage `kebab.lastError` żeby można było skopiować dla diagnostyki.
 */
import { Component, ReactNode } from 'react'

interface State {
  error: Error | null
  errorInfo: { componentStack?: string } | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, errorInfo: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string }) {
    this.setState({ errorInfo })
    try {
      const entry = {
        ts: new Date().toISOString(),
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        url: window.location.href,
      }
      localStorage.setItem('kebab.lastError', JSON.stringify(entry))
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary]', error, errorInfo)
    } catch {}
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 24, fontFamily: 'Inter, system-ui, sans-serif',
          background: '#fff', color: '#0f172a', minHeight: '100vh',
        }}>
          <div style={{ maxWidth: 800, margin: '40px auto' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#b91c1c', marginBottom: 12 }}>
              Coś poszło nie tak
            </h1>
            <p style={{ fontSize: 14, color: '#475569', marginBottom: 16 }}>
              Aplikacja napotkała błąd. Twoje dane są bezpieczne na serwerze.
            </p>
            <button
              onClick={() => { this.setState({ error: null, errorInfo: null }); window.location.reload() }}
              style={{ padding: '8px 16px', borderRadius: 6, background: '#1d4ed8', color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer', marginRight: 8 }}
            >
              Odśwież stronę
            </button>
            <button
              onClick={() => this.setState({ error: null, errorInfo: null })}
              style={{ padding: '8px 16px', borderRadius: 6, background: '#e2e8f0', color: '#0f172a', border: 'none', fontWeight: 600, cursor: 'pointer' }}
            >
              Spróbuj ponownie
            </button>

            <details style={{ marginTop: 24, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', background: '#f1f5f9', padding: 12, borderRadius: 6, color: '#334155' }} open>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#0f172a' }}>Szczegóły błędu (skopiuj do zgłoszenia)</summary>
              <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <strong>{this.state.error.name}: {this.state.error.message}</strong>
                {'\n\n'}
                {this.state.error.stack}
                {this.state.errorInfo?.componentStack && (
                  <>{'\n\n--- Component stack ---'}{this.state.errorInfo.componentStack}</>
                )}
              </div>
            </details>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/** Globalny logger window.onerror + unhandledrejection → localStorage kebab.lastError */
export function installGlobalErrorLogger() {
  if (typeof window === 'undefined') return
  window.addEventListener('error', (e) => {
    try {
      const entry = {
        ts: new Date().toISOString(),
        type: 'error',
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        stack: e.error?.stack,
        url: window.location.href,
      }
      localStorage.setItem('kebab.lastError', JSON.stringify(entry))
      // eslint-disable-next-line no-console
      console.error('[window.onerror]', entry)
    } catch {}
  })
  window.addEventListener('unhandledrejection', (e) => {
    try {
      const entry = {
        ts: new Date().toISOString(),
        type: 'unhandledrejection',
        reason: String(e.reason),
        stack: e.reason?.stack,
        url: window.location.href,
      }
      localStorage.setItem('kebab.lastError', JSON.stringify(entry))
      // eslint-disable-next-line no-console
      console.error('[unhandledrejection]', entry)
    } catch {}
  })
}
