'use client'
/* Screen time — Digital Wellbeing style per-app usage tracking.
 * Log which apps ate the hours; see today's total, weekly trend and top apps. */

import { useEffect, useMemo, useState } from 'react'
import { useLedger } from '@/store/useLedger'
import { I } from '@/components/Icon'
import { RoughBtn, RoughTrack } from '@/components/rough/controls'
import { ScreenRing } from '@/components/rough/charts'
import { Stamp, PanelTitle, ViewHead, EmptyNote } from '@/components/bits'
import { todayStr, isoDaysAgo, fmtDateShort } from '@/lib/dates'
import { SCREEN_CATEGORIES, type ScreenEntryT } from '@/lib/types'
import { hashStr } from '@/lib/colors'
import { chartHex } from '@/lib/themeColors'

const CATEGORY_COLORS: Record<string, number> = {
  social: 5,
  work: 4,
  entertainment: 1,
  learning: 2,
  health: 3,
  other: 7,
}

function fmtHm(mins: number): string {
  if (mins <= 0) return '0m'
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  if (!h) return `${m}m`
  if (!m) return `${h}h`
  return `${h}h ${m}m`
}

export default function ScreenTimeView() {
  const user = useLedger((s) => s.user)
  const screenEntries = useLedger((s) => s.screenEntries)
  const fetchScreenEntries = useLedger((s) => s.fetchScreenEntries)
  const saveScreenEntries = useLedger((s) => s.saveScreenEntries)
  const deleteScreenEntry = useLedger((s) => s.deleteScreenEntry)
  const showToast = useLedger((s) => s.showToast)

  const [date, setDate] = useState(todayStr())
  const [appName, setAppName] = useState('')
  const [minutes, setMinutes] = useState('')
  const [category, setCategory] = useState<string>('social')
  const [saving, setSaving] = useState(false)

  const weekStart = useMemo(() => isoDaysAgo(6), [date])

  useEffect(() => {
    void fetchScreenEntries(weekStart, date)
  }, [fetchScreenEntries, weekStart, date])

  /* --- derivations --- */
  const dayEntries = useMemo(
    () => (screenEntries ?? []).filter((e) => e.date === date).sort((a, b) => b.minutes - a.minutes),
    [screenEntries, date],
  )
  const dayTotal = dayEntries.reduce((s, e) => s + e.minutes, 0)

  const week = useMemo(() => {
    const days: Array<{ date: string; total: number }> = []
    for (let i = 6; i >= 0; i--) {
      const ds = isoDaysAgo(i)
      const total = (screenEntries ?? []).filter((e) => e.date === ds).reduce((s, e) => s + e.minutes, 0)
      days.push({ date: ds, total })
    }
    return days
  }, [screenEntries])

  const weekTotals = week.map((w) => w.total)
  const weekAvg = Math.round(weekTotals.reduce((a, b) => a + b, 0) / 7)
  const weekMax = Math.max(1, ...weekTotals)
  const topApp = useMemo(() => {
    const agg = new Map<string, number>()
    for (const e of screenEntries ?? []) agg.set(e.appName, (agg.get(e.appName) ?? 0) + e.minutes)
    const sorted = Array.from(agg.entries()).sort((a, b) => b[1] - a[1])
    return sorted[0] ?? null
  }, [screenEntries])
  const socialToday = dayEntries
    .filter((e) => e.category === 'social')
    .reduce((s, e) => s + e.minutes, 0)

  const maxDay = Math.max(1, ...dayEntries.map((e) => e.minutes))

  const isToday = date === todayStr()
  const dateNav = (delta: number) => {
    const d = new Date(date + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + delta)
    const next = d.toISOString().slice(0, 10)
    if (next > todayStr()) return
    setDate(next)
  }

  async function addEntry(e?: React.FormEvent) {
    e?.preventDefault()
    const name = appName.trim()
    const mins = Math.round(Number(minutes))
    if (!name) { showToast('Name the app first.'); return }
    if (!mins || mins <= 0) { showToast('How many minutes?'); return }
    setSaving(true)
    const err = await saveScreenEntries(date, [{ appName: name, category, minutes: mins }])
    setSaving(false)
    if (err) { showToast(err); return }
    setAppName('')
    setMinutes('')
    showToast(`${fmtHm(mins)} on ${name} logged ✓`)
  }

  async function removeEntry(id: string) {
    const err = await deleteScreenEntry(id)
    if (err) showToast(err)
    else showToast('Entry removed')
  }

  /* ring fraction vs a sane 6h reference day */
  const ringFrac = Math.min(1, dayTotal / 360)
  const ringColor = dayTotal >= 300 ? chartHex(5) : dayTotal >= 180 ? chartHex(2) : chartHex(4)

  if (!user) return null

  return (
    <>
      <ViewHead title="Screen time" sub={
        <>which apps took the hours · <span className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>{fmtHm(dayTotal)}</span> on {fmtDateShort(date)}</>
      } />

      {/* hero — today's ring + quick stats */}
      <div className="card">
        <Stamp icon="phone">Today</Stamp>
        <div className="screen-hero">
          <div className="screen-ring-wrap">
            <ScreenRing frac={ringFrac} color={ringColor} />
            <div className="screen-ring-center">
              <span className="sr-num">{fmtHm(dayTotal)}</span>
              <span className="sr-sub">screen time</span>
            </div>
          </div>
          <div className="screen-stats">
            <div className="screen-stat">
              <span className="ss-label">7-day average</span>
              <span className={`ss-val ${weekAvg >= 300 ? 'bad' : weekAvg >= 180 ? 'warn' : 'good'}`}>{fmtHm(weekAvg)}/day</span>
            </div>
            <div className="screen-stat">
              <span className="ss-label">most-used app · 7d</span>
              <span className="ss-val">{topApp ? `${topApp[0]} · ${fmtHm(topApp[1])}` : '—'}</span>
            </div>
            <div className="screen-stat">
              <span className="ss-label">social today</span>
              <span className={`ss-val ${socialToday >= 120 ? 'warn' : ''}`}>{fmtHm(socialToday)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* add an app's minutes */}
      <div className="card">
        <Stamp icon="plus">Log app usage</Stamp>
        <form className="st-add-form" onSubmit={addEntry}>
          <input
            type="text"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            placeholder="App name — e.g. Instagram"
            aria-label="App name"
          />
          <input
            type="number"
            min={1}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="minutes"
            aria-label="Minutes"
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            {SCREEN_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <RoughBtn variant="primary" type="submit" className="btn-sm" disabled={saving}>
            <I name="plus" /> Add
          </RoughBtn>
        </form>
        <p className="field-hint" style={{ margin: 0 }}>
          Logging the same app on the same day replaces its minutes — update as often as you like.
        </p>
      </div>

      {/* per-app list for the day */}
      <div className="card">
        <div className="st-date-nav">
          <RoughBtn className="btn-sm" onClick={() => dateNav(-1)} aria-label="Previous day"><I name="chevL" /></RoughBtn>
          <span className="mono" style={{ fontSize: '.8rem', fontWeight: 700 }}>{fmtDateShort(date)}{isToday ? ' · today' : ''}</span>
          <RoughBtn className="btn-sm" onClick={() => dateNav(1)} disabled={isToday} aria-label="Next day"><I name="chevR" /></RoughBtn>
        </div>
        <PanelTitle icon="bars">Apps</PanelTitle>
        {dayEntries.length > 0 ? dayEntries.map((e) => {
          const catColor = chartHex(CATEGORY_COLORS[e.category] ?? 7)
          const appColor = chartHex((hashStr(e.appName) % 7) + 1)
          return (
            <div className="st-app-row" key={e.id}>
              <span className="st-app-icon" style={{ background: appColor }}>{e.appName[0]?.toUpperCase() ?? '?'}</span>
              <span className="st-app-name">{e.appName}</span>
              <span className="st-app-cat" style={{ color: catColor, borderColor: catColor }}>{e.category}</span>
              <span className="st-app-bar"><RoughTrack frac={e.minutes / maxDay} hex={appColor} /></span>
              <span className="st-app-mins">{fmtHm(e.minutes)}</span>
              <button className="st-del" onClick={() => void removeEntry(e.id)} aria-label={`Remove ${e.appName}`} title="Remove">
                <I name="trash" />
              </button>
            </div>
          )
        }) : <EmptyNote>No apps logged for this day yet.</EmptyNote>}
      </div>

      {/* weekly trend */}
      <div className="card">
        <Stamp icon="calendar">This week</Stamp>
        <div className="st-week-bars">
          {week.map((w) => {
            const isSel = w.date === date
            return (
              <div className={`st-week-col${w.date === todayStr() ? ' today' : ''}`} key={w.date}>
                <span className="sw-val">{w.total ? fmtHm(w.total) : ''}</span>
                <div
                  className={`sw-bar${isSel ? ' fill' : ''}`}
                  style={{ height: `${Math.max(3, (w.total / weekMax) * 96)}px` }}
                  title={`${w.date}: ${fmtHm(w.total)}`}
                />
                <span className="sw-label">{fmtDateShort(w.date).slice(0, 3)}</span>
              </div>
            )
          })}
        </div>
        <p className="chart-note">
          7-day trend · peak {fmtHm(weekMax)} · total {fmtHm(weekTotals.reduce((a, b) => a + b, 0))}
        </p>
      </div>
    </>
  )
}
