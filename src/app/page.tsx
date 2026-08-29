'use client'

import { useEffect } from 'react'
import { useLedger } from '@/store/useLedger'
import { Speech } from '@/lib/speech'
import LoginScreen from '@/components/LoginScreen'
import AppShell from '@/components/AppShell'

export default function Page() {
  const booted = useLedger((s) => s.booted)
  const user = useLedger((s) => s.user)
  const boot = useLedger((s) => s.boot)

  useEffect(() => {
    Speech.init()
    boot()
  }, [boot])

  if (!booted) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p className="quote" style={{ color: 'var(--ink-faint)' }}>opening the book…</p>
      </div>
    )
  }

  return user ? <AppShell /> : <LoginScreen />
}
