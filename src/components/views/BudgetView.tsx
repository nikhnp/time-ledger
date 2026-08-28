'use client'

import { useMemo } from 'react'
import { useLedger } from '@/store/useLedger'
import { Stamp, ViewHead } from '@/components/bits'
import { RoughTrack } from '@/components/rough/controls'
import { goalWeekHours } from '@/lib/derivations'
import { goalCat } from '@/lib/colors'
import { currentWeekDates } from '@/lib/dates'

export default function BudgetView() {
  const ledger = useLedger((s) => s.ledger)!
  const updateGoal = useLedger((s) => s.updateGoal)

  const rows = useMemo(() => ledger.goals.map((g) => ({
    g,
    cat: goalCat(g.id, g.color),
    cur: goalWeekHours(ledger, g.id),
    tgt: g.weeklyTargetHours || 8,
  })), [ledger])

  const wk = currentWeekDates()
  void wk

  const tot = rows.reduce((s, r) => s + r.cur, 0)
  const tgt = rows.reduce((s, r) => s + r.tgt, 0)
  const over = rows.filter((r) => r.cur > r.tgt)

  return (
    <>
      <ViewHead title="Budget" sub="hours this week vs weekly targets — click a target to change it" />
      <div className="card">
        <Stamp icon="gauge">Time budget — this week</Stamp>
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
