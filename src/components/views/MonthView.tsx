'use client'

import { useMemo, useState } from 'react'
import { useLedger, useToolEnabled } from '@/store/useLedger'
import { I } from '@/components/Icon'
import { Stamp, ViewHead, NoteRow, EmptyNote, Torn, AIWordsButton } from '@/components/bits'
import { Heatmap, Donut, heatCells } from '@/components/rough/charts'
import { monthList, monthDays, monthLabel, monthLong, currentStreak } from '@/lib/derivations'
import { goalCat } from '@/lib/colors'
import { isoMonthOf, todayStr, fmtDate } from '@/lib/dates'
import { LLM } from '@/lib/llm'

function wordsKey(user: string, id: string) { return `ledger_words_${user.toLowerCase()}_month_${id}` }

export default function MonthView() {
  const ledger = useLedger((s) => s.ledger)!
  const user = useLedger((s) => s.user)!
  const deleteNote = useLedger((s) => s.deleteNote)
  const showToast = useLedger((s) => s.showToast)
  const setSettingsOpen = useLedger((s) => s.setSettingsOpen)

  const notesOn = useToolEnabled('notes')

  const months = useMemo(() => monthList(ledger), [ledger])
  const [idx, setIdx] = useState(() => {
    const i = months.indexOf(isoMonthOf(todayStr()))
    return i >= 0 ? i : months.length - 1
  })
  const [busy, setBusy] = useState(false)
  const m = months[Math.min(idx, months.length - 1)]

  const md = useMemo(() => monthDays(ledger, m), [ledger, m])

  const stats = useMemo(() => {
    const total = md.reduce((s, d) => s + d.activities.reduce((x, a) => x + a.hours, 0), 0)
    const tracked = md.filter((d) => d.activities.length).length
    let best: { h: number; d: (typeof md)[number] } | null = null
    for (const d of md) {
      const h = d.activities.reduce((s, a) => s + a.hours, 0)
      if (!best || h > best.h) best = { h, d }
    }
    const byGoal: Record<string, number> = {}
    md.forEach((d) => d.activities.forEach((a) => { byGoal[a.goalId ?? 'none'] = (byGoal[a.goalId ?? 'none'] ?? 0) + a.hours }))
    return { total, tracked, best, byGoal }
  }, [md])

  const rhythm = useMemo(() => {
    const sums = [0, 0, 0, 0, 0, 0, 0], cnts = [0, 0, 0, 0, 0, 0, 0]
    md.forEach((d) => {
      const dw = new Date(d.date + 'T00:00:00Z').getUTCDay()
      sums[dw] += d.activities.reduce((s, a) => s + a.hours, 0)
      cnts[dw]++
    })
    const avgs = sums.map((s, i) => (cnts[i] ? s / cnts[i] : 0))
    const names = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
    let hi = 0, lo = 0
    avgs.forEach((a, i) => { if (a > avgs[hi]) hi = i; if (a < avgs[lo]) lo = i })
    return { hi, lo, avgs, names }
  }, [md])

  const monthNotes = useMemo(
    () => ledger.notes.filter((n) => isoMonthOf(n.date) === m).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [ledger.notes, m]
  )

  const heatCellsData = useMemo(() => heatCells((date) => {
    const d = ledger.days.find((x) => x.date === date)
    return d ? d.activities.reduce((s, a) => s + a.hours, 0) : 0
  }), [ledger])

  const donutSegs = useMemo(() => Object.entries(stats.byGoal)
    .map(([gid, h]) => {
      const cat = goalCat(gid)
      return { name: ledger.goals.find((g) => g.id === gid)?.name ?? gid, hex: cat.hex, fs: cat.fs, h }
    })
    .sort((a, b) => b.h - a.h), [stats.byGoal, ledger.goals])

  const highlights = useMemo(() => md.filter((d) => d.highlight).map((d) => d.highlight!).slice(-6), [md])

  const [wordsVersion, setWordsVersion] = useState(0)
  const cachedWords = useMemo(() => {
    void wordsVersion
    try {
      const c = JSON.parse(localStorage.getItem(wordsKey(user.name, m)) ?? 'null') as { text: string; model: string } | null
      return c && c.text ? c : null
    } catch { return null }
  }, [user.name, m, wordsVersion])

  async function writeWords() {
    if (!LLM.configured()) { showToast('Configure the LLM first — Settings'); setSettingsOpen(true); return }
    setBusy(true)
    try {
      const text = await LLM.writeWords('month', highlights, `${stats.total.toFixed(0)}h across ${stats.tracked} tracked days, streak ${currentStreak(ledger)}`)
      try { localStorage.setItem(wordsKey(user.name, m), JSON.stringify({ text, model: LLM.modelLabel(), at: Date.now() })) } catch { /* ignore */ }
      setWordsVersion((v) => v + 1)
      showToast('Margin note written ✓')
    } catch (e) {
      showToast(LLM.err('The LLM balked', e))
    }
    setBusy(false)
  }

  return (
    <>
      <div className="range-switch">
        <div className="month-switch">
          <button onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx <= 0} aria-label="Previous month"><I name="chevL" /></button>
          <button className="active">{monthLabel(m)}</button>
          <button onClick={() => setIdx(Math.min(months.length - 1, idx + 1))} disabled={idx >= months.length - 1} aria-label="Next month"><I name="chevR" /></button>
        </div>
      </div>

      <div className="wrapped-hero">
        <div className="wrapped-title">{monthLong(m)}</div>
        <div className="wrapped-sub">your month, at a glance</div>
        <div className="wrapped-stats">
          <div className="wrapped-stat"><div className="ws-num">{stats.total.toFixed(0)}h</div><div className="ws-label">total logged</div></div>
          <div className="wrapped-stat"><div className="ws-num">{stats.tracked}</div><div className="ws-label">days tracked</div></div>
          <div className="wrapped-stat"><div className="ws-num" style={{ color: 'var(--good)' }}>{(stats.tracked ? stats.total / stats.tracked : 0).toFixed(1)}h</div><div className="ws-label">avg / active day</div></div>
          <div className="wrapped-stat"><div className="ws-num" style={{ color: 'var(--warn)' }}>{currentStreak(ledger)}</div><div className="ws-label">day streak</div></div>
        </div>
      </div>

      <div className="wrapped-section">
        <h3>Best day</h3>
        <div className="card" style={{ marginBottom: 0, borderLeft: '4px solid var(--good)', transform: 'rotate(-0.3deg)' }}>
          {stats.best && stats.best.h > 0 ? (
            <>
              <div style={{ fontFamily: 'var(--fm)', fontSize: '.66rem', color: 'var(--ink-faint)', textTransform: 'uppercase', marginBottom: 5 }}>
                {fmtDate(stats.best.d.date)}
              </div>
              <div className="quote" style={{ fontSize: '1.05rem', marginBottom: 7 }}>&quot;{stats.best.d.highlight || 'A big day'}&quot;</div>
              <div style={{ fontFamily: 'var(--fm)', fontSize: '.8rem', color: 'var(--good)', fontWeight: 700 }}>{stats.best.h.toFixed(1)}h logged</div>
            </>
          ) : <EmptyNote>Nothing this month.</EmptyNote>}
        </div>
      </div>

      <div className="wrapped-section">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          Words from the month <AIWordsButton onClick={writeWords} busy={busy} />
        </h3>
        <div className="words-list">
          {cachedWords ? (
            <>
              <p className="words-ai">{cachedWords.text}</p>
              <p className="words-ai-caption">— margin note by {cachedWords.model}</p>
            </>
          ) : highlights.length > 0 ? (
            highlights.map((h, i) => <span className="quote" key={i}>&quot;{h}&quot;</span>)
          ) : <EmptyNote>No words this month.</EmptyNote>}
        </div>
      </div>

      <Torn />

      <div className="card">
        <Stamp icon="grid">Consistency</Stamp>
        <div className="heat-holder"><Heatmap cells={heatCellsData} /></div>
        <p className="chart-note">last 18 weeks, all goals combined</p>
      </div>

      <div className="grid-2">
        <div className="card donut-card">
          <Stamp icon="pie">Where it went</Stamp>
          <div className="donut-holder">
            {donutSegs.length > 0 ? <Donut segs={donutSegs} total={stats.total} /> : <EmptyNote>nothing logged this month</EmptyNote>}
          </div>
          <div className="legend">
            {donutSegs.map((s, i) => (
              <span key={i} style={{ color: s.hex, fontWeight: 600 }}>
                ● {s.name} <span className="mono" style={{ fontSize: '.7rem' }}>{Math.round((s.h / (stats.total || 1)) * 100)}%</span>
              </span>
            ))}
          </div>
        </div>
        <div className="card">
          <Stamp icon="waves">Weekly rhythm</Stamp>
          <p style={{ fontSize: '0.92rem', color: 'var(--ink-soft)', lineHeight: 1.8 }}>
            Heaviest: <strong>{rhythm.names[rhythm.hi]}</strong> (avg {rhythm.avgs[rhythm.hi].toFixed(1)}h).
            Lightest: <strong>{rhythm.names[rhythm.lo]}</strong> (avg {rhythm.avgs[rhythm.lo].toFixed(1)}h).
            {' '}{stats.tracked} of {md.length} days logged.
          </p>
        </div>
      </div>

      {notesOn && (
      <div className="card">
        <Stamp icon="file">Notes from this month</Stamp>
        {monthNotes.length > 0
          ? monthNotes.map((n) => <NoteRow key={n.id} note={n} showDate onDelete={deleteNote} />)
          : <EmptyNote>No notes this month.</EmptyNote>}
      </div>
      )}
    </>
  )
}
