'use client'

import { useMemo, useState } from 'react'
import { useLedger, useToolEnabled } from '@/store/useLedger'
import { I } from '@/components/Icon'
import { RoughBtn, RoughCheck, RoughCell } from '@/components/rough/controls'
import { Spark, Dots, Tally, ProgressBox, GhGrid, Fortnight, HoursToday, Timeline, FocusGauge, HeroStrip, ghCells } from '@/components/rough/charts'
import { Stamp, PanelTitle, ViewHead, NoteRow, EmptyNote, Torn } from '@/components/bits'
import ConsistencyHeatmap from '@/components/ConsistencyHeatmap'
import {
  currentStreak, totalHoursAllTime, tasksDoneThisWeek, habitDoneOn, habitStreak, habitWeekDots,
  priorityTasks, upcomingDeadlines, getRecommendations, isFlagged,
} from '@/lib/derivations'
import { goalCat, habitColor } from '@/lib/colors'
import { accentHex, goodHex, warnHex, chartHex } from '@/lib/themeColors'
import { isoDaysAgo, toMin, todayStr } from '@/lib/dates'
import { LLM } from '@/lib/llm'
import type { DayT } from '@/lib/types'

export default function TodayView() {
  const ledger = useLedger((s) => s.ledger)!
  const toggleHabit = useLedger((s) => s.toggleHabit)
  const updateTask = useLedger((s) => s.updateTask)
  const addNote = useLedger((s) => s.addNote)
  const deleteNote = useLedger((s) => s.deleteNote)
  const addImportantDate = useLedger((s) => s.addImportantDate)
  const showToast = useLedger((s) => s.showToast)
  const setSettingsOpen = useLedger((s) => s.setSettingsOpen)

  /* tool gating — a disabled tool's sections vanish from this page too */
  const habitsOn = useToolEnabled('habits')
  const notesOn = useToolEnabled('notes')
  const goalsOn = useToolEnabled('goals')

  const [noteInput, setNoteInput] = useState('')
  const [extracting, setExtracting] = useState<string | null>(null)

  const t = todayStr()
  const day: DayT | undefined = ledger.days.find((d) => d.date === t)

  const derived = useMemo(() => {
    const last14: number[] = []
    for (let i = 13; i >= 0; i--) {
      const d = ledger.days.find((x) => x.date === isoDaysAgo(i))
      last14.push(d ? d.activities.reduce((s, a) => s + a.hours, 0) : 0)
    }
    const last7: boolean[] = []
    for (let i = 6; i >= 0; i--) {
      const d = ledger.days.find((x) => x.date === isoDaysAgo(i))
      last7.push(!!(d && d.activities.length))
    }
    const tracked = ledger.days.filter((d) => d.activities.length).length
    const total = day ? day.activities.reduce((s, a) => s + a.hours, 0) : 0
    const focus = day && day.activities.length ? Math.round(100 * Math.min(1, total / 6)) : 0
    return { last14, last7, tracked, total, focus }
  }, [ledger, day])

  const dayNumber = useMemo(() => {
    const start = new Date((ledger.meta.startDate || t) + 'T00:00:00Z')
    return Math.max(1, Math.round((new Date(t + 'T00:00:00Z').getTime() - start.getTime()) / 86400000) + 1)
  }, [ledger.meta.startDate, t])

  const hoursRows = useMemo(() => {
    if (!day) return []
    const merged = new Map<string, number>()
    day.activities.forEach((a) => {
      const key = a.label ? `${a.goalId}::${a.label}` : a.goalId ?? 'none'
      merged.set(key, (merged.get(key) ?? 0) + a.hours)
    })
    return Array.from(merged.entries().map(([key, hours]) => {
      const gid = key.includes('::') ? key.split('::')[0] : key
      const label = key.includes('::') ? key.split('::').slice(1).join('::') : null
      const cat = goalCat(gid)
      const g = ledger.goals.find((x) => x.id === gid)
      const name = label ? `${g?.name ?? gid} — ${label}` : (g?.name ?? gid)
      return { name, hours: +hours.toFixed(2), cat }
    }))
  }, [day, ledger.goals])

  const tlBlocks = useMemo(() => {
    if (!day) return []
    return [...day.activities]
      .sort((a, b) => String(a.start ?? '99:99').localeCompare(String(b.start ?? '99:99')))
      .map((a) => {
        const cat = goalCat(a.goalId)
        const s = a.start ? toMin(a.start) : 540
        const e = a.end ? toMin(a.end) : s + Math.round(a.hours * 60)
        return { startMin: s, endMin: e, label: ledger.goals.find((g) => g.id === a.goalId)?.name ?? 'Activity', cat }
      })
  }, [day, ledger.goals])

  const recommendations = useMemo(() => getRecommendations(ledger), [ledger])
  const attention = useMemo(() => priorityTasks(ledger).slice(0, 5), [ledger])
  const deadlines = useMemo(() => upcomingDeadlines(ledger), [ledger])
  const habitCells = useMemo(() => {
    const map: Record<string, Array<{ date: string; done: boolean }>> = {}
    ledger.habits.forEach((h) => {
      map[h.id] = ghCells((date) => habitDoneOn(ledger, h.id, date))
    })
    return map
  }, [ledger])
  const flaggedNotes = useMemo(
    () => ledger.notes.filter((n) => isFlagged(n.text) && n.date >= isoDaysAgo(14)).slice(-2),
    [ledger.notes]
  )
  const todayNotes = useMemo(() => ledger.notes.filter((n) => n.date === t), [ledger.notes, t])
  const alsoToday = useMemo(() => {
    const items: string[] = []
    if (day) {
      day.activities.forEach((a) => items.push(`${a.hours}h on ${ledger.goals.find((g) => g.id === a.goalId)?.name ?? 'something'}`))
      ledger.tasks.forEach((tk) => {
        if (tk.status === 'done' && tk.lastTouched === t) items.push(`Finished "${tk.label}"`)
      })
      ledger.habits.forEach((h) => { if (!h.archived && day.habits[h.id]) items.push(h.name) })
    }
    return items.slice(0, 4)
  }, [day, ledger, t])

  const dateLine = new Date(t + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })

  async function submitNote() {
    const v = noteInput.trim()
    if (!v) { showToast('Write something first.'); return }
    setNoteInput('')
    const id = await addNote(v)
    showToast('Note added ✓')
    /* flagged note + LLM configured → try to read a real date out of it */
    if (id && LLM.configured() && isFlagged(v)) {
      setExtracting(id)
      try {
        const d = await LLM.extractDate(v)
        if (d) {
          const dup = ledger.importantDates.some((x) => x.date === d.date && x.label.trim().toLowerCase() === d.label.trim().toLowerCase())
          if (dup) showToast(`Already in Coming up: ${d.label}`)
          else if (await addImportantDate(d.label, d.date, d.type)) showToast(`Added to Coming up: ${d.label} — ${d.date} ✓`)
        }
      } catch {
        /* silent — the manual button remains */
      }
      setExtracting(null)
    }
  }

  async function manualExtract(noteId: string) {
    const n = ledger.notes.find((x) => x.id === noteId)
    if (!n) return
    if (!LLM.configured()) { showToast('Configure the LLM first — Settings'); setSettingsOpen(true); return }
    setExtracting(noteId)
    try {
      const d = await LLM.extractDate(n.text)
      if (!d) showToast('No clear date in that note.')
      else {
        const dup = ledger.importantDates.some((x) => x.date === d.date && x.label.trim().toLowerCase() === d.label.trim().toLowerCase())
        if (dup) showToast(`Already in Coming up: ${d.label}`)
        else if (await addImportantDate(d.label, d.date, d.type)) showToast(`Added to Coming up: ${d.label} — ${d.date} ✓`)
      }
    } catch (e) {
      showToast(LLM.err('The LLM balked', e))
    }
    setExtracting(null)
  }

  return (
    <>
      <ViewHead title="Today" sub={
        <><span className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>Day {String(dayNumber).padStart(3, '0')}</span> · {dateLine}</>
      } />

      {/* one thing */}
      <div className="card compass-top">
        <div>
          <div className="compass-label"><I name="compass" /> Today&apos;s one thing</div>
          <p className="compass-task">{day?.checkIn ? day.checkIn.answer : 'No check-in yet — add one below.'}</p>
          <div className="checkin">{day?.checkIn ? `"${day.checkIn.question}"` : ''}</div>
        </div>
        <div>
          <div className="compass-strip-head">
            <span>Hours today</span>
            <span>{derived.total ? `${derived.total.toFixed(1)}h` : 'no hours yet'}</span>
          </div>
          {day && day.activities.length > 0 ? (
            <HeroStrip acts={day.activities.map((a) => ({ hours: a.hours, cat: goalCat(a.goalId) }))} />
          ) : (
            <div style={{ height: 22, border: '1.5px dashed var(--rule)', borderRadius: 5 }} />
          )}
          <ul className="also-today">
            {alsoToday.length > 0
              ? alsoToday.map((i, k) => <li key={k}><span className="b" />{i}</li>)
              : <li className="note" style={{ fontSize: '.8rem' }}>Nothing else logged yet.</li>}
          </ul>
        </div>
      </div>

      {/* the numbers */}
      <div className="card">
        <Stamp icon="bars">The numbers</Stamp>
        <div className="ds-grid">
          <RoughCell>
            <div className="ds-num">{totalHoursAllTime(ledger).toFixed(0)}h</div>
            <div className="ds-label">logged all-time</div>
            <div className="ds-viz"><Spark values={derived.last14} color={accentHex()} /></div>
            <div className="ds-annot">last 14 days ↗</div>
          </RoughCell>
          <RoughCell>
            <div className="ds-num">{currentStreak(ledger)}</div>
            <div className="ds-label">day streak</div>
            <div className="ds-viz"><Dots bools={derived.last7} color={goodHex()} /></div>
            <div className="ds-annot">don&apos;t break it →</div>
          </RoughCell>
          <RoughCell>
            <div className="ds-num">{tasksDoneThisWeek(ledger)}</div>
            <div className="ds-label">tasks closed · 7d</div>
            <div className="ds-viz"><Tally n={tasksDoneThisWeek(ledger)} color={warnHex()} /></div>
          </RoughCell>
          <RoughCell>
            <div className="ds-num">{derived.tracked}</div>
            <div className="ds-label">days tracked</div>
            <div className="ds-viz"><ProgressBox frac={derived.tracked / Math.max(1, ledger.days.length)} color={chartHex(4)} /></div>
            <div className="ds-annot">{Math.round((derived.tracked / Math.max(1, ledger.days.length)) * 100)}% of the book</div>
          </RoughCell>
        </div>
      </div>

      {/* focus + fortnight */}
      <div className="grid-2">
        <div className="card">
          <Stamp icon="gauge">Focus score</Stamp>
          <div className="gauge-box">
            <FocusGauge score={derived.focus} />
            <div className="gauge-num">
              <span className="g-num">{derived.focus}</span>
              <span className="g-sub">out of 100</span>
            </div>
          </div>
        </div>
        <div className="card">
          <Stamp icon="waves">The fortnight</Stamp>
          <Fortnight values={derived.last14} />
          <div className="chart-note">
            avg {(derived.last14.reduce((a, b) => a + b, 0) / 14).toFixed(1)}h/day — {derived.last14.filter((v) => v > 0).length} of 14 days logged
          </div>
        </div>
      </div>

      {/* v10 habit tracker — replaced with ConsistencyHeatmap (GitHub-style contribution grid) */}
      {habitsOn && <ConsistencyHeatmap weeks={18} />}

      {/* quick toggle today's habits — kept for fast access */}
      {habitsOn && ledger.habits.some((h) => !h.archived) && (
        <div className="card">
          <Stamp icon="check">Today&apos;s habits</Stamp>
          {ledger.habits.filter((h) => !h.archived).map((h) => {
            const hex = habitColor(h.id, h.color)
            const done = habitDoneOn(ledger, h.id, t)
            return (
              <div className="ht-row" key={h.id} style={{ gridTemplateColumns: '36px 1fr auto' }}>
                <RoughCheck done={done} color={hex} seedKey={h.id} large onClick={() => toggleHabit(h.id)} aria-label={`Toggle ${h.name}`} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '.92rem' }}>{h.name}</div>
                  <div className="mono" style={{ fontSize: '.72rem', color: 'var(--ink-soft)' }}>
                    {habitStreak(ledger, h.id)}d streak · target {h.targetPerWeek}x/week
                  </div>
                </div>
                <span className="habit-streak-badge">{habitWeekDots(ledger, h.id).filter(Boolean).length}/{h.targetPerWeek} this week</span>
              </div>
            )
          })}
        </div>
      )}

      {/* attention / coming up */}
      <div className="attn-grid">
        {goalsOn && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <PanelTitle icon="bell">Needs attention</PanelTitle>
          <div style={{ flex: 1 }}>
            {attention.length > 0 ? attention.map((p) => (
              <div className="attn-row" key={p.task.id}>
                <RoughCheck
                  done={false}
                  seedKey={p.task.id}
                  onClick={() => updateTask(p.task.id, { status: 'done' })}
                  aria-label={`Complete ${p.task.label}`}
                />
                <span className="label">{p.task.label}</span>
                <span className="tag">{p.goalName}</span>
              </div>
            )) : <EmptyNote>Nothing overdue — nice.</EmptyNote>}
          </div>
        </div>
        )}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <PanelTitle icon="calendar">Coming up</PanelTitle>
          <div style={{ flex: 1 }}>
            {deadlines.length > 0 ? deadlines.map((d, i) => (
              <div className="deadline-row" key={i}>
                <span>{d.label}</span>
                <span className={`count${d.du > 14 ? ' far' : ''}`}>
                  {d.du === 0 ? 'today' : d.du > 0 ? `in ${d.du}d` : `${Math.abs(d.du)}d over`}
                </span>
              </div>
            )) : <EmptyNote>Nothing coming up.</EmptyNote>}
            {flaggedNotes.map((n) => (
              <div className="deadline-row" key={n.id}>
                <span style={{ fontStyle: 'italic', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <I name="flag" /> {n.text.length > 56 ? `${n.text.slice(0, 56)}…` : n.text}
                </span>
                <span className="count far">{extracting === n.id ? 'reading…' : 'note'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* worth doing */}
      <div className="worth-strip">
        {recommendations.length > 0 ? recommendations.map((r, i) => (
          <div className="worth-card" key={i} style={{ '--c': r.color, transform: `rotate(${i % 2 ? 0.4 : -0.4}deg)` } as React.CSSProperties}>
            <div className="worth-head">
              <span className="worth-icon"><I name={r.icon} /></span>
              <span className="worth-tag">{r.tag}</span>
            </div>
            <div dangerouslySetInnerHTML={{ __html: r.text }} />
          </div>
        )) : (
          <div className="worth-card" style={{ '--c': 'var(--sage)' } as React.CSSProperties}>
            <div>Nothing needs nudging. Rare — enjoy it.</div>
          </div>
        )}
      </div>

      <Torn />

      {/* where the hours went */}
      <div className="card">
        <Stamp icon="pie">Where the hours went</Stamp>
        {hoursRows.length > 0
          ? <HoursToday rows={hoursRows} total={derived.total} />
          : <EmptyNote>No hours yet today.</EmptyNote>}
      </div>

      {/* timeline */}
      <div className="card">
        <Stamp icon="activity">Timeline</Stamp>
        <div className="tl-axis"><span>6am</span><span>9</span><span>12pm</span><span>3</span><span>6</span><span>9</span><span>12am</span></div>
        {tlBlocks.length > 0 ? <Timeline blocks={tlBlocks} /> : <EmptyNote>no blocks yet</EmptyNote>}
      </div>

      {/* notes */}
      {notesOn && (
      <div className="card">
        <Stamp icon="file">Today&apos;s notes</Stamp>
        <div className="note-add">
          <input
            type="text"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitNote() }}
            placeholder="Jot something — deadlines, ideas, reminders…"
          />
          <RoughBtn variant="primary" className="btn-sm" onClick={submitNote}>
            <I name="plus" /> Add note
          </RoughBtn>
        </div>
        {todayNotes.length > 0
          ? todayNotes.map((n) => (
              <NoteRow key={n.id} note={n} onDelete={deleteNote} onExtract={manualExtract} />
            ))
          : <EmptyNote>Nothing jotted yet today.</EmptyNote>}
      </div>
      )}
    </>
  )
}
