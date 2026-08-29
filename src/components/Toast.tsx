'use client'

import { useEffect, useState } from 'react'
import { useLedger } from '@/store/useLedger'

function ToastInner({ msg }: { msg: string }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 2600)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className={`toast${visible ? ' show' : ''}`} role="status" aria-live="polite">
      {msg}
    </div>
  )
}

export default function Toast() {
  const toast = useLedger((s) => s.toast)
  if (!toast) return null
  return <ToastInner key={toast.at} msg={toast.msg} />
}
