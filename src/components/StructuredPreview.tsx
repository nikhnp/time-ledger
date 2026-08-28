'use client'
/* Structured preview — review an LLM (or JSON) delta line by line before it goes in the book.
 * Each line can be toggled off; the raw JSON can be edited; then Confirm & merge. */

import { useState } from 'react'
import { useLedger } from '@/store/useLedger'
import { I } from '@/components/Icon'
import { RoughBtn } from '@/components/rough/controls'
import type { ValidatedDelta } from '@/lib/derivations'
import type { MergeResult } from '@/lib/types'
import { todayStr } from '@/lib/dates'

interface Item {
  kind: 'activity' | 'habit' | 'metric' | 'note' | 'highlight' | 'check-in'
  on: boolean
  text: React.ReactNode
  act: unknown
}

function buildItems(delta: ValidatedDelta, goalNames: Record<string, string>, habitNames: Record<string, string>, metricNames: Record<string, string>): Item[] {
  const items: Item[] = []
  delta.activities.forEach((a) => {
    items.push({
      kind: 'activity',
      on: true,
      text: (
        <>
          <strong>{a.hours}h</strong> → {a.goalId ? (goalNames[a.goalId] ?? a.goalId) : 'Uncategorized'}
          {a.start && (
            <span className="mono" style={{ fontSize: '.7rem', color: 'var(--ink-faint)' }}> ({a.start}{a.end ? `–${a.end}` : ''})</span>
          )}
          {a.label ? ` — ${a.label}` : ''}
        </>
      ),
      act: a,
    })
  })
  delta.habits.forEach((h) => {
    items.push({
      kind: 'habit',
      on: true,
      text: <>{habitNames[h.habitId] ?? h.habitId}: <strong>{h.done ? 'done' : 'skipped'}</strong></>,
      act: h,
    })
  })
  delta.metrics.forEach((m) => {
    items.push({
      kind: 'metric',
      on: true,
      text: <>{metricNames[m.metricId] ?? m.metricId} = <strong>{m.value}</strong></>,
      act: m,
    })
  })
  delta.newNotes.forEach((n) => {
    items.push({ kind: 'note', on: true, text: <>“{n}”</>, act: n })
  })
  if (delta.highlight) {
    items.push({ kind: 'highlight', on: true, text: <>Highlight: {delta.highlight}</>, act: delta.highlight })
  }
  if (delta.checkIn) {
    items.push({ kind: 'check-in', on: true, text: <>Check-in: “{delta.checkIn.answer}”</>, act: delta.checkIn })
  }
  return items
}

export default function StructuredPreview({
  result, onDone, onDiscard,
}: {
  result: { delta: ValidatedDelta; skipped: string[] }
  onDone: () => void
  onDiscard: () => void
}) {
  const ledger = useLedger((s) => s.ledger)!
  const mergeDeltas = useLedger((s) => s.mergeDeltas)
  const showToast = useLedger((s) => s.showToast)
  const closeSheets = useLedger((s) => s.closeSheets)

  const goalNames = Object.fromEntries(ledger.goals.map((g) => [g.id, g.name]))
  const habitNames = Object.fromEntries(ledger.habits.map((h) => [h.id, h.name]))
  const metricNames = Object.fromEntries(ledger.metrics.map((m) => [m.id, `${m.name} (${m.unit})`]))

  const [items, setItems] = useState(() => buildItems(result.delta, goalNames, habitNames, metricNames))
  const [editing, setEditing] = useState(false)
  const [jsonText, setJsonText] = useState(() => JSON.stringify(result.delta, null, 1))
  const [busy, setBusy] = useState(false)

  function toggle(i: number) {
    setItems((prev) => prev.map((it, k) => (k === i ? { ...it, on: !it.on } : it)))
  }

  async function confirm() {
    setBusy(true)
    const on = items.filter((it) => it.on)
    const delta = {
      date: result.delta.date,
      activities: on.filter((it) => it.kind === 'activity').map((it) => it.act as ValidatedDelta['activities'][number]),
      habits: on.filter((it) => it.kind === 'habit').map((it) => it.act as ValidatedDelta['habits'][number]),
      metrics: on.filter((it) => it.kind === 'metric').map((it) => it.act as ValidatedDelta['metrics'][number]),
      newNotes: on.filter((it) => it.kind === 'note').map((it) => it.act as string),
      highlight: on.some((it) => it.kind === 'highlight') ? result.delta.highlight : undefined,
      checkIn: on.some((it) => it.kind === 'check-in') ? result.delta.checkIn : undefined,
    }
    const r = await mergeDeltas([delta])
    setBusy(false)
    if ('error' in r) { showToast(r.error); return }
    const res: MergeResult | undefined = r.results[0]
    const c = res?.counts
    const bits: string[] = []
    if (c?.activities) bits.push(`${c.activities} activit${c.activities > 1 ? 'ies' : 'y'}`)
    if (c?.habits) bits.push(`${c.habits} habit${c.habits > 1 ? 's' : ''}`)
    if (c?.notes) bits.push(`${c.notes} note${c.notes > 1 ? 's' : ''}`)
    showToast(`Merged into ${delta.date || todayStr()} ✓${bits.length ? ` — ${bits.join(', ')}` : ''}`)
    closeSheets()
    onDone()
  }

  function useJSON() {
    try {
      const obj = JSON.parse(jsonText) as Record<string, unknown>
      onParsed(obj)
    } catch (e) {
      showToast(`That JSON didn't parse: ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  }

  function onParsed(obj: Record<string, unknown>) {
    /* re-validate against the ledger */
    import('@/lib/derivations').then(({ validateDelta }) => {
      const v = validateDelta(ledger, obj)
      setItems(buildItems(v.delta, goalNames, habitNames, metricNames))
      setJsonText(JSON.stringify(v.delta, null, 1))
      setEditing(false)
    })
  }

  if (editing) {
    return (
      <div className="preview-box">
        <div className="preview-head">
          <span className="preview-title">fix the delta by hand</span>
        </div>
        <textarea id="jsonEditArea" value={jsonText} onChange={(e) => setJsonText(e.target.value)} style={{ minHeight: 130 }} />
        <div className="preview-actions">
          <RoughBtn variant="primary" className="btn-sm" onClick={useJSON}>Use this JSON</RoughBtn>
          <RoughBtn className="btn-sm" onClick={() => setEditing(false)}>Back</RoughBtn>
        </div>
      </div>
    )
  }

  return (
    <div className="preview-box">
      <div className="preview-head">
        <span className="preview-title"><I name="spark" /> structured preview — review before it goes in the book</span>
        <span className="preview-model">{result.delta.date}</span>
      </div>
      {result.skipped.length > 0 && (
        <p className="llm-err" style={{ marginBottom: 8 }}>skipped: {result.skipped.join(' · ')}</p>
      )}
      {items.length > 0 ? items.map((it, i) => (
        <div className={`preview-row${it.on ? '' : ' off'}`} key={i}>
          <button
            type="button"
            className={`preview-check${it.on ? ' on' : ''}`}
            onClick={() => toggle(i)}
            role="checkbox"
            aria-checked={it.on}
            aria-label="Include this line"
          />
          <span className="pr-main">{it.text}</span>
          <span className="pr-tag">{it.kind}</span>
        </div>
      )) : <p className="note" style={{ fontSize: '.84rem' }}>Nothing recognized in that.</p>}
      <div className="preview-actions">
        <RoughBtn variant="primary" className="btn-sm" onClick={confirm} disabled={busy}>
          {busy ? 'Merging…' : 'Confirm & merge'}
        </RoughBtn>
        <RoughBtn className="btn-sm" onClick={onDiscard}>Discard</RoughBtn>
        <RoughBtn className="btn-sm" onClick={() => setEditing(true)}>Fix as JSON</RoughBtn>
      </div>
    </div>
  )
}
