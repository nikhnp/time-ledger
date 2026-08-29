'use client'

import { useMemo, useState } from 'react'
import { useLedger } from '@/store/useLedger'
import { I } from '@/components/Icon'
import { RoughBtn } from '@/components/rough/controls'
import { Stamp, ViewHead, EmptyNote } from '@/components/bits'
import { RoughTrack } from '@/components/rough/controls'
import { goalCurrent, goalsOf, hobbiesOf, weekHoursOf } from '@/lib/derivations'
import { goalCat } from '@/lib/colors'
import { daysUntil } from '@/lib/dates'

export default function GoalsView() {
  const ledger = useLedger((s) => s.ledger)!
  const updateGoal = useLedger((s) => s.updateGoal)
  const addGoal = useLedger((s) => s.addGoal)
  const deleteGoal = useLedger((s) => s.deleteGoal)
  const logGoalHours = useLedger((s) => s.logGoalHours)
  const [adding, setAdding] = useState<string | null>(null)
  const [msInput, setMsInput] = useState('')
  /* v10.5: per-goal quick actions */
  const [logging, setLogging] = useState<string | null>(null)
  const [hoursInput, setHoursInput] = useState('1')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  /* P2-2: pursuits — two tabs over one Goal store */
  const [tab, setTab] = useState<'goals' | 'hobbies'>('goals')
  const goals = useMemo(() => goalsOf(ledger), [ledger])
  const hobbies = useMemo(() => hobbiesOf(ledger), [ledger])
  const shown = tab === 'goals' ? goals : hobbies

  /* new-goal form */
  const [newName, setNewName] = useState('')
  const [newTarget, setNewTarget] = useState('30')
  const [newWeekly, setNewWeekly] = useState('8')
  const [creating, setCreating] = useState(false)

  async function submitGoal(e?: React.FormEvent) {
    e?.preventDefault()
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    const ok = await addGoal(name, {
      target: Number(newTarget) || 30,
      weeklyTargetHours: Number(newWeekly) || 8,
      kind: tab === 'hobbies' ? 'hobby' : 'goal', // the tab decides what you're creating
    })
    setCreating(false)
    if (ok) {
      setNewName('')
      setNewTarget('30')
      setNewWeekly('8')
    }
  }

  return (
    <>
      <ViewHead title="Goals" sub="the long game — milestones are clickable" />

      {/* P2-2: pursuits tabs — hobbies live beside goals, not in a silo */}
      <div className="segmented" style={{ marginBottom: 14 }}>
        <button className={`seg-btn${tab === 'goals' ? ' active' : ''}`} onClick={() => setTab('goals')} aria-pressed={tab === 'goals'}>
          <I name="target" /> Goals ({goals.length})
        </button>
        <button className={`seg-btn${tab === 'hobbies' ? ' active' : ''}`} onClick={() => setTab('hobbies')} aria-pressed={tab === 'hobbies'}>
          <I name="spark" /> Hobbies ({hobbies.length})
        </button>
      </div>

      {/* v11: create a goal — fresh accounts start with an empty book */}
      <div className="card">
        <Stamp icon="plus">{tab === 'goals' ? 'Add a goal' : 'Add a hobby'}</Stamp>
        <form onSubmit={submitGoal} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: 2, minWidth: 160, fontSize: '.74rem', fontWeight: 600, color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: 5 }}>
            Name
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Deep work" />
          </label>
          <label style={{ width: 90, fontSize: '.74rem', fontWeight: 600, color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: 5 }}>
            Target
            <input type="number" min={1} value={newTarget} onChange={(e) => setNewTarget(e.target.value)} aria-label="Total target" />
          </label>
          <label style={{ width: 90, fontSize: '.74rem', fontWeight: 600, color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: 5 }}>
            h / week
            <input type="number" min={0.5} step={0.5} value={newWeekly} onChange={(e) => setNewWeekly(e.target.value)} aria-label="Weekly target hours" />
          </label>
          <RoughBtn variant="primary" className="btn-sm" type="submit" disabled={creating}>
            <I name="plus" /> Add
          </RoughBtn>
        </form>
      </div>

      <div className="card">
        <Stamp icon="target">{tab === 'goals' ? 'Goals' : 'Hobbies'}</Stamp>
        {shown.length === 0 && (
          <EmptyNote>
            {tab === 'goals'
              ? 'No goals yet — add your first above.'
              : 'No hobbies yet — a hobby is a pursuit with weekly hours and no deadline pressure. Add one above.'}
          </EmptyNote>
        )}
        <div className="goal-grid">
          {shown.map((g) => {
            const cat = goalCat(g.id, g.color)
            const cur = goalCurrent(ledger, g.id)
            const wk = weekHoursOf(ledger, g.id)
            const du = daysUntil(g.deadline)
            const dl = g.kind === 'hobby'
              ? `${wk.toFixed(1)}/${g.weeklyTargetHours}h this week`
              : du === null ? 'no deadline' : du >= 0 ? `${du}d left` : `${Math.abs(du)}d overdue`
            return (
              <div className="goal-card" style={{ borderLeft: `3px solid ${cat.hex}` }} key={g.id}>
                <h4>{g.name}</h4>
                <div style={{ fontSize: '.68rem', color: 'var(--ink-faint)', fontFamily: 'var(--fm)' }}>
                  {dl} · {g.milestones.filter((m) => m.done).length}/{g.milestones.length} milestones
                </div>
                <RoughTrack frac={cur / g.target} hex={cat.hex} fillStyle={cat.fs} style={{ height: 14, margin: '14px 0 8px' }} />
                <div className="goal-meta">
                  <span>{cur.toFixed(1)} / {g.target} {g.unit}</span>
                  <span>{((cur / g.target) * 100).toFixed(0)}%</span>
                </div>

                {/* v10.5: quick-log hours + deadline + delete */}
                <div className="goal-quick">
                  {logging === g.id ? (
                    <span className="goal-log-row">
                      <input
                        autoFocus
                        type="number"
                        min={0.25}
                        step={0.25}
                        value={hoursInput}
                        onChange={(e) => setHoursInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const h = parseFloat(hoursInput)
                            if (h > 0) { logGoalHours(g.id, h); setLogging(null) }
                          }
                          if (e.key === 'Escape') setLogging(null)
                        }}
                        aria-label="Hours to log"
                      />
                      <RoughBtn className="btn-sm" onClick={() => { const h = parseFloat(hoursInput); if (h > 0) { logGoalHours(g.id, h); setLogging(null) } }}>Log</RoughBtn>
                      <button className="icon-btn" title="Cancel" onClick={() => setLogging(null)}><I name="x" /></button>
                    </span>
                  ) : (
                    <RoughBtn className="btn-sm" onClick={() => { setLogging(g.id); setHoursInput('1') }}>
                      <I name="plus" /> Log hours
                    </RoughBtn>
                  )}
                  <label className="goal-deadline" title="Deadline — shows up in Coming up on Today">
                    by
                    <input
                      type="date"
                      value={g.deadline ?? ''}
                      onChange={(e) => updateGoal(g.id, { deadline: e.target.value || null })}
                    />
                  </label>
                  {confirmDelete === g.id ? (
                    <span className="habit-confirm">
                      Delete goal + its tasks?
                      <button className="icon-btn" title="Confirm delete" onClick={() => { deleteGoal(g.id); setConfirmDelete(null) }}>
                        <I name="check" />
                      </button>
                      <button className="icon-btn" title="Keep it" onClick={() => setConfirmDelete(null)}>
                        <I name="x" />
                      </button>
                    </span>
                  ) : (
                    <button className="icon-btn" title="Delete goal" onClick={() => setConfirmDelete(g.id)}>
                      <I name="trash" />
                    </button>
                  )}
                </div>
                <div className="goal-ms">
                  {g.milestones.map((m, i) => (
                    <div
                      key={i}
                      className={`goal-ms-row${m.done ? ' done' : ''}`}
                      onClick={() => {
                        const next = g.milestones.map((mm, ii) => (ii === i ? { ...mm, done: !mm.done } : mm))
                        updateGoal(g.id, { milestones: next })
                      }}
                      role="checkbox"
                      aria-checked={m.done}
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click() } }}
                    >
                      <span className="dot" />
                      <span>{m.label}</span>
                    </div>
                  ))}
                  {adding === g.id ? (
                    <div className="goal-ms-add">
                      <input
                        autoFocus
                        value={msInput}
                        onChange={(e) => setMsInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && msInput.trim()) {
                            updateGoal(g.id, { milestones: [...g.milestones, { label: msInput.trim(), done: false }] })
                            setMsInput('')
                            setAdding(null)
                          }
                          if (e.key === 'Escape') { setAdding(null); setMsInput('') }
                        }}
                        placeholder="milestone name…"
                      />
                    </div>
                  ) : (
                    <button className="icon-btn" onClick={() => setAdding(g.id)} title="Add milestone">
                      <I name="plus" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
