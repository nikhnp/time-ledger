'use client'
/* Focus session — countdown ring, chime, and a one-tap "put it in the book".
 * v11: the timer body is shared — it renders inside its own modal (FocusModal)
 * and as a tab inside the Add sheet (EntrySheet). */

import { useEffect, useRef, useState } from 'react'
import { useLedger } from '@/store/useLedger'
import { I } from '@/components/Icon'
import { RoughBtn } from '@/components/rough/controls'
import { FocusRing } from '@/components/rough/charts'
import { Stamp } from '@/components/bits'
import { hmDate, todayStr } from '@/lib/dates'
import type { MergeResult } from '@/lib/types'

function fmt(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function FocusTimer({ onLogged }: { onLogged?: () => void }) {
  const ledger = useLedger((s) => s.ledger)!
  const mergeDeltas = useLedger((s) => s.mergeDeltas)
  const showToast = useLedger((s) => s.showToast)

  const [minutes, setMinutes] = useState(25)
  const [total, setTotal] = useState(25 * 60)
  const [left, setLeft] = useState(25 * 60)
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [startedAt, setStartedAt] = useState<Date | null>(null)
  const [goalId, setGoalId] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  function setMin(m: number) {
    if (running) { showToast('Timer is running — let it finish or close it.'); return }
    setMinutes(m)
    setTotal(m * 60)
    setLeft(m * 60)
  }

  function tick() {
    setLeft((l) => {
      if (l <= 1) {
        if (intervalRef.current) clearInterval(intervalRef.current)
        setRunning(false)
        setPaused(false)
        chime()
        showToast('Focus session done — nicely held.')
        return 0
      }
      return l - 1
    })
  }

  function start() {
    setStartedAt(new Date())
    setRunning(true)
    setPaused(false)
    intervalRef.current = setInterval(tick, 1000)
  }

  function pauseResume() {
    if (!running) return
    if (paused) {
      setPaused(false)
      intervalRef.current = setInterval(tick, 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
      setPaused(true)
    }
  }

  function chime() {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      const ctx = new AC()
      ;[0, 0.28, 0.56].forEach((t, i) => {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.frequency.value = i === 1 ? 660 : 880
        o.type = 'sine'
        g.gain.setValueAtTime(0.001, ctx.currentTime + t)
        g.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + t + 0.03)
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.22)
        o.connect(g)
        g.connect(ctx.destination)
        o.start(ctx.currentTime + t)
        o.stop(ctx.currentTime + t + 0.24)
      })
      setTimeout(() => ctx.close(), 1400)
    } catch { /* no audio */ }
  }

  function reset() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setRunning(false)
    setPaused(false)
    setStartedAt(null)
    setLeft(total)
  }

  async function logSession() {
    const gid = goalId || ledger.goals[0]?.id
    if (!gid) return
    const hours = +(minutes / 60).toFixed(2)
    const start = startedAt ?? new Date()
    const endD = new Date(start.getTime() + minutes * 60000)
    const r = await mergeDeltas([{
      date: todayStr(),
      activities: [{ goalId: gid, hours, start: hmDate(start), end: hmDate(endD), label: 'Focus session' }],
    }])
    const res: MergeResult | undefined = 'results' in r ? r.results[0] : undefined
    void res
    onLogged?.()
    showToast(`Focus session logged → ${ledger.goals.find((g) => g.id === gid)?.name} ✓`)
  }

  const done = left === 0 && !running

  return (
    <div className="timer-face">
      <div className="focus-ring-wrap">
        <FocusRing frac={left / total} />
        <div className="focus-digits">{fmt(left)}</div>
      </div>
      {!done ? (
        <>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', margin: '12px 0' }}>
            {[25, 40, 60].map((m) => (
              <RoughBtn
                key={m}
                variant={minutes === m ? 'primary' : 'ghost'}
                className="btn-sm"
                onClick={() => setMin(m)}
              >
                {m}
              </RoughBtn>
            ))}
          </div>
          <div className="focus-custom">
            <span className="note" style={{ fontSize: '.74rem' }}>custom</span>
            <input
              type="number"
              min={1}
              max={180}
              placeholder="min"
              aria-label="Custom minutes"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = Number((e.target as HTMLInputElement).value)
                  if (v > 0 && v <= 180) { setMin(v); showToast(`${v} minutes — go`) }
                }
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {!running ? (
              <RoughBtn variant="primary" onClick={start}>Start</RoughBtn>
            ) : (
              <>
                <RoughBtn variant="primary" onClick={pauseResume}>{paused ? 'Resume' : 'Pause'}</RoughBtn>
                <RoughBtn onClick={reset}>Restart</RoughBtn>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="focus-log show">
          <p className="note" style={{ textAlign: 'center', fontSize: '.84rem', marginBottom: 10 }}>
            Session done — put it in the book?
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <select value={goalId || (ledger.goals[0]?.id ?? '')} onChange={(e) => setGoalId(e.target.value)} aria-label="Goal">
              {ledger.goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <RoughBtn variant="primary" className="btn-sm" onClick={logSession}>
              <I name="plus" /> Log session
            </RoughBtn>
          </div>
        </div>
      )}
    </div>
  )
}

export default function FocusModal() {
  const open = useLedger((s) => s.focusOpen)
  const setOpen = useLedger((s) => s.setFocusOpen)

  if (!open) return null

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
      <div className="modal modal-narrow">
        <button className="modal-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
        <Stamp icon="clock">Focus session</Stamp>
        <FocusTimer onLogged={() => setOpen(false)} />
      </div>
    </div>
  )
}
