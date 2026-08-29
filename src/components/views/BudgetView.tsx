'use client'

import { useMemo, useState } from 'react'
import { useLedger } from '@/store/useLedger'
import { I } from '@/components/Icon'
import { RoughBtn } from '@/components/rough/controls'
import { Stamp, ViewHead, EmptyNote } from '@/components/bits'
import { RoughTrack } from '@/components/rough/controls'
import { goalWeekHours } from '@/lib/derivations'
import { goalCat } from '@/lib/colors'

export default function BudgetView() {
  const ledger = useLedger((s) => s.ledger)!
  const updateGoal = useLedger((s) => s.updateGoal)
  const addGoal = useLedger((s) => s.addGoal)

  /* add-budget-item form — a budget item IS a goal with a weekly time target */
  const [newName, setNewName] = useState('')
  const [newWeekly, setNewWeekly] = useState('4')
  const [creating, setCreating] = useState(false)

  async function submitBudgetItem(e?: React.FormEvent) {
    e?.preventDefault()
    const name = newName.trim()
    if (!name) { useLedger.getState().showToast('Give the budget item a name.'); return }
    setCreating(true)
    const ok = await addGoal(name, {
      target: 30,
      weeklyTargetHours: Number(newWeekly) || 4,
    })
    setCreating(false)
    if (ok) {
      setNewName('')
      setNewWeekly('4')
      useLedger.getState().showToast('Budget item added — it also appears in Goals ✓')
    }
  }

  const rows = useMemo(() => ledger.goals.map((g) => ({
    g,
    cat: goalCat(g.id, g.color),
    cur: goalWeekHours(ledger, g.id),
    tgt: g.weeklyTargetHours || 8,
  })), [ledger])

  const tot = rows.reduce((s, r) => s + r.cur, 0)
  const tgt = rows.reduce((s, r) => s + r.tgt, 0)
  const over = rows.filter((r) => r.cur > r.tgt)

  return (
    <>
      <ViewHead title="Budget" sub="hours this week vs weekly targets — click a target to change it" />

      {/* v10.5: budget items are addable — each one is a goal with a weekly time target */}
      <div className="card">
        <Stamp icon="plus">Add a budget item</Stamp>
        {ledger.goals.length === 0 && <EmptyNote>No budget items yet — add your first below.</EmptyNote>}
        <form onSubmit={submitBudgetItem} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: 2, minWidth: 160, fontSize: '.74rem', fontWeight: 600, color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: 5 }}>
            What are you budgeting time for?
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Learning Spanish" />
          </label>
          <label style={{ width: 120, fontSize: '.74rem', fontWeight: 600, color: 'var(--ink-soft)', display: 'flex', flexDirection: 'column', gap: 5 }}>
            h / week
            <input type="number" min={0.5} step={0.5} value={newWeekly} onChange={(e) => setNewWeekly(e.target.value)} aria-label="Weekly budget hours" />
          </label>
          <RoughBtn variant="primary" className="btn-sm" type="submit" disabled={creating}>
            <I name="plus" /> Add
          </RoughBtn>
        </form>
      </div>

      <div className="card">
        <Stamp icon="gauge">Time budget — this week</Stamp>
        {rows.length === 0 && <EmptyNote>Nothing budgeted yet.</EmptyNote>}
        {rows.map((r) => {
          const isOver = r.cur > r.tgt
          return (
            <div className="bar-row" key={r.g.id}>
              <span className="bar-name" style={{ color: r.cat.hex }}>{r.g.name}</span>
              <RoughTrack frac={r.cur / r.tgt} hex={r.cat.hex} fillStyle={r.cat.fs} />
              <span className="bar-val" style={isOver ? { color: r.cat.hex, fontWeight: 700 } : undefined}>
                {r.cur.toFixed(1)}h /{' '}
                <input
                  className="budget-edit"
                  defaultValue={r.tgt}
                  title="weekly target (hours)"
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value)
                    if (v > 0 && v < 200 && v !== r.tgt) {
                      updateGoal(r.g.id, { weeklyTargetHours: v })
                      useLedger.getState().showToast(`Weekly target saved — ${v}h`)
                    }
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                />
                h{isOver ? ' ⚠' : ''}
              </span>
            </div>
          )
        })}
        <p className="chart-note">
          this week: {tot.toFixed(1)}h against {tgt}h budgeted
          {over.length > 0 && ` — ${over.map((r) => `${r.g.name} over by ${(r.cur - r.tgt).toFixed(1)}h`).join(', ')}. Where did it go?`}
        </p>
      </div>
    </>
  )
}
