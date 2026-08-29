'use client'

import { Component, type ReactNode } from 'react'
import { useLedger } from '@/store/useLedger'

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * v10.5 — catches render crashes inside the capture sheet. Previously a crash
 * left the dark scrim + an empty near-black sheet on screen ("blank black
 * popup"), with no way to close it. Now the user gets a readable fallback.
 */
export default class SheetErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <>
        <div className="sheet-scrim open" onClick={() => this.setState({ error: null })} />
        <div className="sheet open" role="dialog" aria-modal="true" aria-label="Capture failed">
          <div style={{ padding: '28px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ margin: 0 }}>The capture sheet hit a snag</h3>
            <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--ink-soft)' }}>
              Nothing was lost — your ledger is untouched. Close this and try again; if it keeps
              happening, use the Manual tab or the type-it fallback in Record.
            </p>
            <code style={{ fontSize: '.68rem', color: 'var(--ink-faint)', wordBreak: 'break-all' }}>
              {this.state.error.message}
            </code>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-sm" onClick={() => this.setState({ error: null })}>Close</button>
              <button
                className="btn-sm"
                onClick={() => { useLedger.getState().refresh(); this.setState({ error: null }) }}
              >
                Reload data
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }
}
