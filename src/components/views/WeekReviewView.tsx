'use client'
/* P3-1: the weekly review — your week, read back to you.
 * Renders from EXACTLY ONE request (/api/review/week) for any week,
 * navigable with this-week / last-week arrows and deep-linkable
 * (?view=review&start=YYYY-MM-DD). "Copy as text" renders the review to
 * Markdown on the clipboard — no new export surface. */

import { useCallback, useEffect, useState } from 'react'
import { useLedger } from '@/store/useLedger'
import { I } from '@/components/Icon'
import { RoughBtn } from '@/components/rough/controls'
import { RoughTrack } from '@/components/rough/controls'
import { Stamp, ViewHead, EmptyNote } from '@/components/bits'
import { todayStr, s2d, d2s } from '@/lib/dates'

interface ReviewData {
  start: string
  end: string
  pursuits: Array<{ id: string; name: string; kind: 'goal' | 'hobby'; hours: number; weeklyTargetHours: number; hit: boolean; deadlineInDays: number | null }>
  unassignedHours: number
  habits: Array<{ id: string; name: string; archived: boolean; hits: number; targetPerWeek: number; streak: number }>
  topActivities: Array<{ label: string; hours: number }>
  totals: { hours: number; activeDays: number }
  noteCount: number
  checkInCount: number
  planCount: number
  plannedVsDone: Array<{ goalId: string; name: string; planned: number; done: number }>
  screen: { totalMinutes: number; topCategory: { category: string; minutes: number } | null }
  empty: boolean
}

function mondayOf(s: string): string {
  const d = s2d(s)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d2s(d)
}

function label(start: string): string {
  const s = new Date(start + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const e = new Date(mondayOf(start) + 'T00:00:00Z')
  e.setUTCDate(e.getUTCDate() + 6)
  const es = e.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${s} – ${es}`
}

function toMarkdown(d: ReviewData): string {
  const lines: string[] = []
  lines.push(`# Week of ${label(d.start)}`)
  lines.push('')
  lines.push(`**${d.totals.hours.toFixed(1)}h** logged across ${d.totals.activeDays}/7 active days · ${d.checkInCount} of 7 nights reflected`)
  lines.push('')
  lines.push('## Pursuits')
  for (const p of d.pursuits) {
    lines.push(`- ${p.name}${p.kind === 'hobby' ? ' (hobby)' : ''}: ${p.hours.toFixed(1)}h${p.weeklyTargetHours ? ` / ${p.weeklyTargetHours}h target` : ''}${p.hit ? ' ✓ hit' : ''}`)
  }
  if (d.unassignedHours > 0) lines.push(`- Unassigned: ${d.unassignedHours.toFixed(1)}h`)
  lines.push('')
  lines.push('## Habits')
  for (const h of d.habits.filter((x) => !x.archived)) {
    lines.push(`- ${h.name}: ${h.hits}/${h.targetPerWeek} this week${h.streak > 1 ? ` · ${h.streak}d streak` : ''}`)
  }
  if (d.topActivities.length) {
    lines.push('')
    lines.push('## Top activities')
    for (const t of d.topActivities) lines.push(`- ${t.label}: ${t.hours.toFixed(1)}h`)
  }
  if (d.plannedVsDone.length) {
    lines.push('')
    lines.push('## Planned vs done')
    for (const p of d.plannedVsDone) lines.push(`- ${p.name}: planned ${p.planned.toFixed(1)}h, done ${p.done.toFixed(1)}h`)
  }
  if (d.screen.totalMinutes > 0) {
    lines.push('')
    lines.push(`Screen time: ${(d.screen.totalMinutes / 60).toFixed(1)}h${d.screen.topCategory ? ` (most: ${d.screen.topCategory.category})` : ''}`)
  }
  return lines.join('\n')
}

export default function WeekReviewView() {
  const fetchReview = useLedger((s) => s.fetchReview)
  const showToast = useLedger((s) => s.showToast)

  /* deep link: ?view=review&start=YYYY-MM-DD — read in the initializer
   * (no setState-in-effect) */
  const [start, setStart] = useState(() => {
    try {
      if (typeof window !== 'undefined') {
        const q = new URLSearchParams(window.location.search).get('start')
        if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return mondayOf(q)
      }
    } catch { /* ignore */ }
    return mondayOf(todayStr())
  })
  const [data, setData] = useState<ReviewData | null>(null)
  const [busy, setBusy] = useState(true)

  const load = useCallback(
    (s: string) => {
      /* setState only in the promise callback — nothing sync in effects */
      let cancelled = false
      fetchReview(s)
        .then((r) => {
          if (cancelled) return
          if (r) setData(r as unknown as ReviewData)
        })
        .catch(() => { /* keep the last good week on screen */ })
        .finally(() => {
          if (!cancelled) setBusy(false)
        })
      return () => {
        cancelled = true
      }
    },
    [fetchReview],
  )

  useEffect(() => load(start), [start, load])

  function shift(delta: number) {
    setBusy(true)
    const d = s2d(start)
    d.setUTCDate(d.getUTCDate() + delta * 7)
    setStart(d2s(d))
  }

  async function copyAsText() {
    if (!data) return
    try {
      await navigator.clipboard.writeText(toMarkdown(data))
      showToast('Review copied as Markdown ✓')
    } catch {
      showToast('Clipboard refused — select and copy manually.')
    }
  }

  const isThisWeek = start === mondayOf(todayStr())

  return (
    <>
      <ViewHead title="Review" sub="one request, your whole week — nothing re-fetched per section" />
      <div className="range-switch">
        <div className="month-switch">
          <button onClick={() => shift(-1)} aria-label="Previous week"><I name="chevL" /></button>
          <button className="active">{label(start)}</button>
          <button onClick={() => shift(1)} disabled={isThisWeek} aria-label="Next week"><I name="chevR" /></button>
        </div>
      </div>

      {busy && !data && <EmptyNote>Adding up the week…</EmptyNote>}

      {data && (
        <>
          <div className="wrapped-hero">
            <div className="wrapped-title">{isThisWeek ? 'This week' : label(start)}</div>
            <div className="wrapped-sub">the week, reviewed</div>
            <div className="wrapped-stats">
              <div className="wrapped-stat"><div className="ws-num">{data.totals.hours.toFixed(1)}h</div><div className="ws-label">logged</div></div>
              <div className="wrapped-stat"><div className="ws-num">{data.totals.activeDays}/7</div><div className="ws-label">days active</div></div>
              <div className="wrapped-stat"><div className="ws-num" style={{ color: 'var(--good)' }}>{data.checkInCount}</div><div className="ws-label">nights reflected</div></div>
              <div className="wrapped-stat"><div className="ws-num" style={{ color: 'var(--warn)' }}>{data.noteCount}</div><div className="ws-label">notes</div></div>
            </div>
          </div>

          {data.empty && (
            <div className="card"><EmptyNote>A blank week — nothing logged, nothing reflected. It happens; next week is unwritten.</EmptyNote></div>
          )}

          {data.pursuits.length > 0 && (
            <div className="card">
              <Stamp icon="target">Pursuits vs targets</Stamp>
              {data.pursuits.map((p) => (
                <div key={p.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.86rem', fontWeight: 600 }}>
                    <span>{p.name}{p.kind === 'hobby' ? <span className="mono" style={{ fontSize: '.66rem', color: 'var(--ink-faint)' }}> hobby</span> : null}</span>
                    <span className="mono" style={{ fontSize: '.76rem', color: p.hit ? 'var(--good)' : 'var(--ink-soft)' }}>
                      {p.hours.toFixed(1)} / {p.weeklyTargetHours}h{p.hit ? ' ✓' : ''}
                    </span>
                  </div>
                  <RoughTrack frac={Math.min(1, p.hours / Math.max(0.5, p.weeklyTargetHours))} hex={p.hit ? 'var(--good)' : 'var(--accent)'} fillStyle="hachture" style={{ height: 12, marginTop: 4 }} />
                </div>
              ))}
              {data.unassignedHours > 0 && (
                <p className="chart-note">+ {data.unassignedHours.toFixed(1)}h unassigned</p>
              )}
            </div>
          )}

          {data.habits.some((h) => !h.archived) && (
            <div className="card">
              <Stamp icon="check">Habits — hit rate</Stamp>
              {data.habits.filter((h) => !h.archived).map((h) => (
                <div className="habit-row" style={{ gridTemplateColumns: '1fr auto auto' }} key={h.id}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '.9rem' }}>{h.name}</div>
                    <div style={{ fontSize: '.66rem', color: 'var(--ink-faint)', fontFamily: 'var(--fm)' }}>
                      {h.hits}/{h.targetPerWeek} this week{h.streak > 1 ? ` · ${h.streak}d streak` : ''}
                    </div>
                  </div>
                  <div className="habit-mini-heat">
                    {Array.from({ length: h.targetPerWeek }, (_, i) => (
                      <span key={i} className={i < h.hits ? 'hit' : ''} style={i < h.hits ? { background: 'var(--good)' } : undefined} />
                    ))}
                  </div>
                  <span className="habit-streak-badge">{Math.round((h.hits / Math.max(1, h.targetPerWeek)) * 100)}%</span>
                </div>
              ))}
            </div>
          )}

          {data.plannedVsDone.length > 0 && (
            <div className="card">
              <Stamp icon="calendar">Planned vs done</Stamp>
              {data.plannedVsDone.map((p) => (
                <div className="deadline-row" key={p.goalId}>
                  <span>{p.name}</span>
                  <span className="mono" style={{ fontSize: '.76rem', color: 'var(--ink-soft)' }}>
                    planned {p.planned.toFixed(1)}h · done {p.done.toFixed(1)}h
                  </span>
                </div>
              ))}
              <p className="chart-note" style={{ marginTop: 6 }}>the close-the-day loop&apos;s report card — {data.planCount} night{data.planCount === 1 ? '' : 's'} planned</p>
            </div>
          )}

          {data.topActivities.length > 0 && (
            <div className="card">
              <Stamp icon="bars">Top activities</Stamp>
              <ol style={{ paddingLeft: 20, fontSize: '0.9rem', lineHeight: 2 }}>
                {data.topActivities.map((t, i) => (
                  <li key={i}>
                    {t.label} <span className="mono" style={{ color: 'var(--ink-faint)', fontSize: '.75rem' }}>{t.hours.toFixed(1)}h</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {data.screen.totalMinutes > 0 && (
            <div className="card">
              <Stamp icon="phone">Screen time</Stamp>
              <p style={{ fontSize: '.92rem', color: 'var(--ink-soft)' }}>
                {(data.screen.totalMinutes / 60).toFixed(1)}h across the week
                {data.screen.topCategory ? ` — mostly ${data.screen.topCategory.category} (${(data.screen.topCategory.minutes / 60).toFixed(1)}h)` : ''}.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <RoughBtn className="btn-sm" onClick={copyAsText}>
              <I name="paste" /> Copy as text
            </RoughBtn>
          </div>
        </>
      )}
    </>
  )
}
