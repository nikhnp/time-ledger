'use client'

import { useMemo, useState } from 'react'
import { useLedger, useToolEnabled } from '@/store/useLedger'
import { I } from '@/components/Icon'
import { Stamp, ViewHead, NoteRow, EmptyNote, AIWordsButton } from '@/components/bits'
import { WeekChart } from '@/components/rough/charts'
import { allWeeks, weekDates, habitDoneOn, habitStreak, currentStreak } from '@/lib/derivations'
import { goalCat, habitColor } from '@/lib/colors'
import { fmtRange, fmtDate, todayStr, isoLocal } from '@/lib/dates'
import { LLM } from '@/lib/llm'
import type { DayT } from '@/lib/types'

function wordsKey(user: string, id: string) { return `ledger_words_${user.toLowerCase()}_week_${id}` }

export default function WeekView() {
  const ledger = useLedger((s) => s.ledger)!
  const user = useLedger((s) => s.user)!
  const deleteNote = useLedger((s) => s.deleteNote)
  const editNote = useLedger((s) => s.editNote)
  const showToast = useLedger((s) => s.showToast)
  const setSettingsOpen = useLedger((s) => s.setSettingsOpen)

  const habitsOn = useToolEnabled('habits')
  const notesOn = useToolEnabled('notes')

  const weeks = useMemo(() => allWeeks(ledger), [ledger])
  const [idx, setIdx] = useState(() => {
    const nowD = todayStr()
    const i = weeks.findIndex((w) => { const s = isoLocal(w.start), e = isoLocal(w.end); return nowD >= s && nowD <= e })
    return i >= 0 ? i : 0
  })
  const [busy, setBusy] = useState(false)

  const w = weeks[Math.min(idx, weeks.length - 1)]
  const dates = useMemo(() => (w ? weekDates(w) : []), [w])
  const days = useMemo(() => dates.map((ds) => ledger.days.find((d) => d.date === ds)), [dates, ledger.days])
  const isCurrent = dates.includes(todayStr())
  const label = isCurrent ? 'This week' : (w ? fmtRange(w.start, w.end) : '')

  const stats = useMemo(() => {
    const totals = days.map((d) => (d ? d.activities.reduce((s, a) => s + a.hours, 0) : 0))
    const weekTotal = totals.reduce((a, b) => a + b, 0)
    const active = totals.filter((t) => t > 0).length
    let best: { h: number; d: DayT } | null = null
    for (let i = 0; i < days.length; i++) {
      const d = days[i]
      if (d && totals[i] > 0 && (!best || totals[i] > best.h)) best = { h: totals[i], d }
    }
    let habitHits = 0
    ledger.habits.forEach((h) => dates.forEach((ds) => { if (habitDoneOn(ledger, h.id, ds)) habitHits++ }))
    // v10.3 fix: guard against division by zero when no habits exist
    const habitPct = ledger.habits.length === 0 ? 0 : Math.round((habitHits / (ledger.habits.length * 7)) * 100)
    const byGoal: Record<string, number> = {}
    days.forEach((d) => d?.activities.forEach((a) => { byGoal[a.goalId ?? 'none'] = (byGoal[a.goalId ?? 'none'] ?? 0) + a.hours }))
    return { totals, weekTotal, active, best, habitPct, byGoal }
  }, [days, dates, ledger])

  const weekNotes = useMemo(() => {
    const ds = new Set(dates)
    return ledger.notes.filter((n) => ds.has(n.date)).sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [ledger.notes, dates])

  /* P2-9: dated items land on their day — the week renders them on it */
  const weekDates2 = useMemo(() => new Set(dates), [dates])
  const weekDated = useMemo(
    () => ledger.importantDates.filter((d) => weekDates2.has(d.date)).sort((a, b) => (a.date < b.date ? -1 : 1)),
    [ledger.importantDates, weekDates2],
  )

  const spanId = w ? isoLocal(w.start) : ''
  const [wordsVersion, setWordsVersion] = useState(0)
  const cachedWords = useMemo(() => {
    void wordsVersion
    try {
      const c = JSON.parse(localStorage.getItem(wordsKey(user.name, spanId)) ?? 'null') as { text: string; model: string } | null
      return c && c.text ? c : null
    } catch { return null }
  }, [user.name, spanId, wordsVersion])

  const stacks = useMemo(() => dates.map((ds, i) => {
    const d = days[i]
    const dw = new Date(ds + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })
    const blocks = (d?.activities ?? []).map((a) => ({ hours: a.hours, cat: goalCat(a.goalId) }))
    return { label: dw, total: stats.totals[i], blocks }
  }), [dates, days, stats.totals])

  const highlights = useMemo(
    () => days.filter((d) => d?.highlight).map((d) => d!.highlight!).slice(-6),
    [days]
  )

  async function writeWords() {
    if (!LLM.configured()) { showToast('Configure the LLM first — Settings'); setSettingsOpen(true); return }
    setBusy(true)
    try {
      const text = await LLM.writeWords('week', highlights, `${stats.weekTotal.toFixed(1)}h logged, ${stats.active}/7 days active, ${stats.habitPct}% habits hit`)
      try { localStorage.setItem(wordsKey(user.name, spanId), JSON.stringify({ text, model: LLM.modelLabel(), at: Date.now() })) } catch { /* ignore */ }
      setWordsVersion((v) => v + 1)
      showToast('Margin note written ✓')
    } catch (e) {
      showToast(LLM.err('The LLM balked', e))
    }
    setBusy(false)
  }

  return (
    <>
      <ViewHead title="Week" sub="every week, all the way back" />
      <div className="range-switch">
        <div className="month-switch">
          <button onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx <= 0} aria-label="Previous week"><I name="chevL" /></button>
          <button className="active">{label}</button>
          <button onClick={() => setIdx(Math.min(weeks.length - 1, idx + 1))} disabled={idx >= weeks.length - 1} aria-label="Next week"><I name="chevR" /></button>
        </div>
      </div>

      <div className="wrapped-hero">
        <div className="wrapped-title">{label}</div>
        <div className="wrapped-sub">the week, wrapped</div>
        <div className="wrapped-stats">
          <div className="wrapped-stat"><div className="ws-num">{stats.weekTotal.toFixed(1)}h</div><div className="ws-label">logged</div></div>
          <div className="wrapped-stat"><div className="ws-num">{stats.active}/7</div><div className="ws-label">days active</div></div>
          <div className="wrapped-stat"><div className="ws-num" style={{ color: 'var(--good)' }}>{stats.best ? stats.best.h.toFixed(1) : '—'}h</div><div className="ws-label">best day</div></div>
          {habitsOn && <div className="wrapped-stat"><div className="ws-num" style={{ color: 'var(--warn)' }}>{stats.habitPct}%</div><div className="ws-label">habits hit</div></div>}
        </div>
      </div>

      <div className="wrapped-section">
        <h3>Best day</h3>
        <div className="card" style={{ marginBottom: 0, borderLeft: '4px solid var(--good)', transform: 'rotate(-0.3deg)' }}>
          {stats.best ? (
            <>
              <div style={{ fontFamily: 'var(--fm)', fontSize: '.66rem', color: 'var(--ink-faint)', textTransform: 'uppercase', marginBottom: 5 }}>
                {fmtDate(stats.best.d.date)}
              </div>
              <div className="quote" style={{ fontSize: '1.05rem', marginBottom: 7 }}>&quot;{stats.best.d.highlight || 'A big day'}&quot;</div>
              <div style={{ fontFamily: 'var(--fm)', fontSize: '.8rem', color: 'var(--good)', fontWeight: 700 }}>{stats.best.h.toFixed(1)}h logged</div>
            </>
          ) : <EmptyNote>Nothing logged this week — yet.</EmptyNote>}
        </div>
      </div>

      <div className="wrapped-section">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          Words from the week <AIWordsButton onClick={writeWords} busy={busy} />
        </h3>
        <div className="words-list">
          {cachedWords ? (
            <>
              <p className="words-ai">{cachedWords.text}</p>
              <p className="words-ai-caption">— margin note by {cachedWords.model}</p>
            </>
          ) : highlights.length > 0 ? (
            highlights.slice(-5).map((h, i) => <span className="quote" key={i}>&quot;{h}&quot;</span>)
          ) : <EmptyNote>No words this week.</EmptyNote>}
        </div>
      </div>

      <div className="card">
        <Stamp icon="activity">By day</Stamp>
        <WeekChart stacks={stacks} />
      </div>

      <div className="grid-2">
        <div className="card">
          <Stamp icon="bars">Top activities</Stamp>
          <ol style={{ paddingLeft: 20, fontSize: '0.9rem', lineHeight: 2.1 }}>
            {Object.entries(stats.byGoal).sort((a, b) => b[1] - a[1]).map(([gid, h]) => (
              <li key={gid}>
                {ledger.goals.find((g) => g.id === gid)?.name ?? gid}
                <span className="mono" style={{ color: 'var(--ink-faint)', fontSize: '.75rem' }}> {h.toFixed(1)}h</span>
              </li>
            ))}
            {Object.keys(stats.byGoal).length === 0 && <li className="note">Nothing logged.</li>}
          </ol>
        </div>
        {habitsOn && (
        <div className="card">
          <Stamp icon="check">Habits this week</Stamp>
          {ledger.habits.map((h) => {
            const hex = habitColor(h.id, h.color)
            const dots = dates.map((ds) => habitDoneOn(ledger, h.id, ds))
            const hits = dots.filter(Boolean).length
            return (
              <div className="habit-row" style={{ gridTemplateColumns: '1fr auto auto' }} key={h.id}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '.9rem' }}>{h.name}</div>
                  <div style={{ fontSize: '.66rem', color: 'var(--ink-faint)', fontFamily: 'var(--fm)' }}>{hits}/{h.targetPerWeek} this week</div>
                </div>
                <div className="habit-mini-heat">
                  {dots.map((on, i) => (
                    <span key={i} className={on ? 'hit' : ''} style={on ? { background: hex } : undefined} />
                  ))}
                </div>
                <span className="habit-streak-badge">{habitStreak(ledger, h.id)}d</span>
              </div>
            )
          })}
        </div>
        )}
      </div>

      {/* P2-9: deadlines and future-dated items render on their day */}
      {weekDated.length > 0 && (
      <div className="card">
        <Stamp icon="calendar">Dates this week</Stamp>
        {weekDated.map((d) => {
          const dw = new Date(d.date + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
          return (
            <div className="deadline-row" key={d.id}>
              <span><strong>{dw}</strong> · {d.label}</span>
              <span className="count">{d.type}</span>
            </div>
          )
        })}
      </div>
      )}

      {notesOn && (
      <div className="card">
        <Stamp icon="file">Notes from this week</Stamp>
        {weekNotes.length > 0
          ? weekNotes.map((n) => <NoteRow key={n.id} note={n} showDate onDelete={deleteNote} onEdit={editNote} />)
          : <EmptyNote>No notes this week.</EmptyNote>}
        <p className="chart-note">streak right now: {currentStreak(ledger)} days</p>
      </div>
      )}
    </>
  )
}
