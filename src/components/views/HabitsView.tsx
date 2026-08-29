'use client'

import { useState } from 'react'
import { useLedger } from '@/store/useLedger'
import { I } from '@/components/Icon'
import { RoughBtn, RoughCheck } from '@/components/rough/controls'
import { Stamp, ViewHead, EmptyNote } from '@/components/bits'
import { habitDoneOn, habitStreak, habitWeekDots } from '@/lib/derivations'
import { habitColor } from '@/lib/colors'
import { todayStr } from '@/lib/dates'

export default function HabitsView() {
  const ledger = useLedger((s) => s.ledger)!
  const toggleHabit = useLedger((s) => s.toggleHabit)
  const addHabit = useLedger((s) => s.addHabit)
  const updateHabit = useLedger((s) => s.updateHabit)
  const deleteHabit = useLedger((s) => s.deleteHabit)
  const t = todayStr()

  /* new-habit form */
  const [name, setName] = useState('')
  const [perWeek, setPerWeek] = useState('7')
  const [creating, setCreating] = useState(false)

  /* per-habit edit state */
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  async function submitHabit(e?: React.FormEvent) {
    e?.preventDefault()
    const n = name.trim()
    if (!n) return
    setCreating(true)
    const ok = await addHabit(n, Number(perWeek) || 7)
    setCreating(false)
    if (ok) {
      setName('')
      setPerWeek('7')
    }
  }

  function startRename(id: string, current: string) {
    setRenaming(id)
    setRenameVal(current)
  }

  async function commitRename(id: string) {
    const v = renameVal.trim()
    setRenaming(null)
    if (v) await updateHabit(id, { name: v.slice(0, 60) })
  }

  const active = ledger.habits.filter((h) => !h.archived)
  const archived = ledger.habits.filter((h) => h.archived)

  return (
    <>
      <ViewHead title="Habits" sub="streaks are built daily" />

      {/* v11: create a habit */}
      <div className="card">
        <Stamp icon="plus">Add a habit</Stamp>
        <form onSubmit={submitHabit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: 2, minWidth: 160, fontSize: '.74rem', fontWeight: 600, color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: 5 }}>
            Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Meditate" />
          </label>
          <label style={{ width: 110, fontSize: '.74rem', fontWeight: 600, color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: 5 }}>
            x / week
            <input type="number" min={1} max={7} value={perWeek} onChange={(e) => setPerWeek(e.target.value)} aria-label="Times per week" />
          </label>
          <RoughBtn variant="primary" className="btn-sm" type="submit" disabled={creating}>
            <I name="plus" /> Add
          </RoughBtn>
        </form>
      </div>

      <div className="card">
        <Stamp icon="check">Daily habits</Stamp>
        {active.length === 0 && <EmptyNote>No habits yet — add your first above.</EmptyNote>}
        {active.map((h) => {
          const hex = habitColor(h.id, h.color)
          const done = habitDoneOn(ledger, h.id, t)
          const dots = habitWeekDots(ledger, h.id)
          return (
            <div className="habit-row" key={h.id}>
              <RoughCheck done={done} color={hex} seedKey={h.id} large onClick={() => toggleHabit(h.id)} aria-label={`Toggle ${h.name}`} />
              <div style={{ minWidth: 0 }}>
                {renaming === h.id ? (
                  <input
                    autoFocus
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onBlur={() => commitRename(h.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(h.id)
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    aria-label="Rename habit"
                  />
                ) : (
                  <div style={{ fontWeight: 600, fontSize: '.92rem' }}>{h.name}</div>
                )}
                <div style={{ fontSize: '.66rem', color: 'var(--ink-faint)', fontFamily: 'var(--fm)' }}>{h.targetPerWeek}x / week target</div>
              </div>
              <div className="habit-mini-heat">
                {dots.map((on, i) => <span key={i} className={on ? 'hit' : ''} style={on ? { background: hex } : undefined} />)}
              </div>
              <span className="habit-streak-badge">{habitStreak(ledger, h.id)}d streak</span>
              <div className="habit-tools">
                <button className="icon-btn" title="Rename" onClick={() => startRename(h.id, h.name)}>
                  <I name="pencil" />
                </button>
                <button
                  className="icon-btn"
                  title="Archive — hides it, keeps history"
                  onClick={() => { updateHabit(h.id, { archived: true }); useLedger.getState().showToast(`${h.name} archived — find it below`) }}
                >
                  <I name="box" />
                </button>
                {confirmDelete === h.id ? (
                  <span className="habit-confirm">
                    Delete history too?
                    <button className="icon-btn" title="Confirm delete" onClick={() => { deleteHabit(h.id); setConfirmDelete(null) }}>
                      <I name="check" />
                    </button>
                    <button className="icon-btn" title="Keep it" onClick={() => setConfirmDelete(null)}>
                      <I name="x" />
                    </button>
                  </span>
                ) : (
                  <button className="icon-btn" title="Delete permanently" onClick={() => setConfirmDelete(h.id)}>
                    <I name="trash" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {archived.length > 0 && (
        <div className="card">
          <Stamp icon="box">Archived — history kept, hidden from today</Stamp>
          {archived.map((h) => (
            <div className="habit-row" key={h.id}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '.92rem', color: 'var(--ink-soft)' }}>{h.name}</div>
                <div style={{ fontSize: '.66rem', color: 'var(--ink-faint)', fontFamily: 'var(--fm)' }}>
                  was {h.targetPerWeek}x / week · {habitWeekDots(ledger, h.id).filter(Boolean).length}/7 last week
                </div>
              </div>
              <div className="habit-tools">
                <RoughBtn className="btn-sm" onClick={() => { updateHabit(h.id, { archived: false }); useLedger.getState().showToast(`${h.name} is back ✓`) }}>
                  Restore
                </RoughBtn>
                {confirmDelete === h.id ? (
                  <span className="habit-confirm">
                    Delete history too?
                    <button className="icon-btn" title="Confirm delete" onClick={() => { deleteHabit(h.id); setConfirmDelete(null) }}>
                      <I name="check" />
                    </button>
                    <button className="icon-btn" title="Keep it" onClick={() => setConfirmDelete(null)}>
                      <I name="x" />
                    </button>
                  </span>
                ) : (
                  <button className="icon-btn" title="Delete permanently" onClick={() => setConfirmDelete(h.id)}>
                    <I name="trash" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
