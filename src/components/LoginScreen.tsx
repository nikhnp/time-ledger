'use client'

import { useEffect, useState } from 'react'
import { useLedger } from '@/store/useLedger'
import { RoughBtn } from '@/components/rough/controls'
import { I } from '@/components/Icon'

type Mode = 'signin' | 'signup' | 'reset'

type SetupStatus =
  | { initialized: true; userCount: number; loading?: false; error?: undefined }
  | { initialized: false; error: string; loading?: false }
  | { initialized: false; loading: true; error?: undefined }

export default function LoginScreen() {
  const login = useLedger((s) => s.login)
  const signup = useLedger((s) => s.signup)
  const [mode, setMode] = useState<Mode>('signin')
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [setup, setSetup] = useState<SetupStatus>({ initialized: false, loading: true })
  const [resetToken, setResetToken] = useState<string | null>(null)
  const [resetName, setResetName] = useState<string>('')
  const [resetStatus, setResetStatus] = useState<'verifying' | 'ready' | 'submitting' | 'done' | 'error'>('verifying')

  // v10: check for ?reset=TOKEN in URL on mount
  useEffect(() => {
    const url = new URL(window.location.href)
    const token = url.searchParams.get('reset')
    if (token) {
      setResetToken(token)
      setMode('reset')
      setResetStatus('verifying')
      fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', token }),
      })
        .then((r) => r.json().catch(() => ({})))
        .then((data: { valid?: boolean; name?: string; error?: string }) => {
          if (data.valid && data.name) {
            setResetName(data.name)
            setResetStatus('ready')
          } else {
            setErr(data.error ?? 'invalid or expired reset link')
            setResetStatus('error')
          }
        })
        .catch(() => {
          setErr('network error')
          setResetStatus('error')
        })
      // Clean the URL so the token doesn't linger in browser history
      window.history.replaceState({}, document.title, url.pathname)
    }
  }, [])

  // Ask the server whether the DB is set up and how many users exist.
  // If zero users, default to signup mode (first user becomes admin).
  useEffect(() => {
    if (resetToken) return // skip if we're in reset mode
    let cancelled = false
    fetch('/api/auth/setup-status', { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((data: { initialized?: boolean; userCount?: number; error?: string }) => {
        if (cancelled) return
        if (data.initialized) {
          setSetup({ initialized: true, userCount: data.userCount ?? 0 })
          if ((data.userCount ?? 0) === 0) setMode('signup')
        } else {
          setSetup({ initialized: false, error: data.error ?? 'unknown' })
          // Still default to signup — the user might want to try
          setMode('signup')
        }
      })
      .catch(() => {
        if (!cancelled)
          setSetup({ initialized: false, error: 'network' })
      })
    return () => {
      cancelled = true
    }
  }, [resetToken])

  async function submitReset() {
    if (busy) return
    if (pw.length < 6) { setErr('Password must be at least 6 characters.'); return }
    if (pw !== pw2) { setErr('Passwords do not match.'); return }
    if (!resetToken) { setErr('Missing reset token.'); return }
    setBusy(true)
    setResetStatus('submitting')
    setErr('')
    try {
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset', token: resetToken, password: pw }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErr(data.error ?? `Reset failed (HTTP ${r.status})`)
        setResetStatus('ready')
        return
      }
      // Successfully reset — boot the app (session cookie was set by server)
      setResetStatus('done')
      await useLedger.getState().boot()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'network error')
      setResetStatus('ready')
    } finally {
      setBusy(false)
    }
  }

  function toggleMode() {
    setErr('')
    setPw('')
    setPw2('')
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
  }

  async function submit() {
    if (busy) return
    setErr('')

    if (mode === 'signup' && pw !== pw2) {
      setErr("Passwords don't match.")
      return
    }

    setBusy(true)
    const error =
      mode === 'signin'
        ? await login(name.trim(), pw)
        : await signup(name.trim(), pw)
    if (error) setErr(error)
    setBusy(false)
  }

  const signupHint =
    mode === 'signup' && setup.initialized && setup.userCount === 0
      ? 'First account becomes the admin.'
      : mode === 'signup'
        ? 'Create a new account.'
        : null

  const dbNotConfigured =
    !setup.loading && !setup.initialized && setup.error === 'db-not-configured'
  const dbNotSynced =
    !setup.loading && !setup.initialized && setup.error === 'db-not-synced'

  return (
    <div className="login-screen">
      <div className="login-card">
        <div
          className="brand"
          style={{
            justifyContent: 'center',
            marginBottom: 8,
            paddingBottom: 14,
            borderBottom: '1px solid var(--rule)',
          }}
        >
          <span className="brand-icon">
            <I name="spark" />
          </span>
          <span className="brand-name">Ledger</span>
        </div>
        <p className="login-sub">
          {mode === 'signin'
            ? 'whose book is this?'
            : mode === 'signup'
              ? 'open a new book'
              : resetStatus === 'verifying'
                ? 'verifying reset link…'
                : resetStatus === 'done'
                  ? 'password reset — opening your book…'
                  : `reset password for ${resetName}`}
        </p>

        {dbNotConfigured && (
          <div
            className="login-hint"
            style={{
              border: '1px solid var(--rule)',
              padding: 10,
              borderRadius: 6,
              marginBottom: 12,
            }}
          >
            <strong>Database not configured.</strong>
            <br />
            Set <code>DATABASE_URL</code> in Netlify env vars to your Neon
            connection string, then redeploy.
          </div>
        )}

        {dbNotSynced && (
          <div
            className="login-hint"
            style={{
              border: '1px solid var(--rule)',
              padding: 10,
              borderRadius: 6,
              marginBottom: 12,
            }}
          >
            <strong>Database not initialized.</strong>
            <br />
            Run this locally with your Neon <code>DATABASE_URL</code>:
            <br />
            <code
              style={{
                display: 'inline-block',
                marginTop: 6,
                padding: '4px 8px',
                background: 'var(--rule)',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              npx prisma db push
            </code>
          </div>
        )}

        {mode === 'reset' ? (
          <form
            onSubmit={(e) => { e.preventDefault(); submitReset() }}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {resetStatus === 'verifying' && (
              <p className="login-hint" style={{ textAlign: 'center' }}>Verifying your reset link…</p>
            )}
            {resetStatus === 'ready' && (
              <>
                <p className="login-hint" style={{ textAlign: 'center' }}>
                  Hi <strong>{resetName}</strong> — pick a new password.
                </p>
                <label className="field">
                  New password
                  <input
                    type="password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    autoFocus
                    minLength={6}
                  />
                </label>
                <label className="field">
                  Confirm new password
                  <input
                    type="password"
                    value={pw2}
                    onChange={(e) => setPw2(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    minLength={6}
                  />
                </label>
                <RoughBtn variant="primary" type="submit" disabled={busy} className="btn-block">
                  {busy ? 'Resetting…' : 'Reset password & sign in'}
                </RoughBtn>
                {err && <p className="login-err">{err}</p>}
                <p className="login-hint" style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => { setResetToken(null); setMode('signin'); setErr(''); setPw(''); setPw2('') }}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', fontSize: 'inherit' }}
                  >
                    Back to sign in
                  </button>
                </p>
              </>
            )}
            {resetStatus === 'error' && (
              <>
                <p className="login-err">{err}</p>
                <p className="login-hint" style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => { setResetToken(null); setMode('signin'); setErr('') }}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', fontSize: 'inherit' }}
                  >
                    Back to sign in
                  </button>
                </p>
              </>
            )}
          </form>
        ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <label className="field">
            Username
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="your name"
              autoComplete="username"
              autoFocus
            />
          </label>

          <label className="field">
            Password
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </label>

          {mode === 'signup' && (
            <label className="field">
              Confirm password
              <input
                type="password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </label>
          )}

          <RoughBtn
            variant="primary"
            type="submit"
            disabled={busy}
            className="btn-block"
          >
            {busy
              ? mode === 'signin'
                ? 'Opening the book…'
                : 'Creating your book…'
              : mode === 'signin'
                ? 'Open the ledger'
                : 'Create account'}
          </RoughBtn>

          {signupHint && (
            <p className="login-hint" style={{ textAlign: 'center' }}>
              {signupHint}
            </p>
          )}

          {err && <p className="login-err">{err}</p>}

          <p className="login-hint" style={{ textAlign: 'center' }}>
            <button
              type="button"
              onClick={toggleMode}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'inherit',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: 'inherit',
              }}
            >
              {mode === 'signin'
                ? "Don't have an account? Sign up"
                : 'Already have an account? Sign in'}
            </button>
          </p>
        </form>
        )}
      </div>
    </div>
  )
}
