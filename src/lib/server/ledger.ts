import {
  assembleLedgerRaw,
  findGoalsByUser,
  findHabitsByUser,
  findMetricsByUser,
  upsertDay,
  createActivity,
  upsertDayHabit,
  upsertDayMetric,
  createNote,
} from '@/lib/neon-sql'
import { generateId } from '@/lib/server/cuid'
import type { MergeDelta, MergeResult } from '@/lib/types'

/* ---------- date helpers (UTC-midnight discipline) ---------- */
export function d2s(d: Date): string { return d.toISOString().slice(0, 10) }
export function s2d(s: string): Date { return new Date(s + 'T00:00:00Z') }
export function todayStr(): string { return new Date().toISOString().slice(0, 10) }
export function validDateStr(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(s2d(s).getTime())
}
export function validTimeStr(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}

/* ---------- assemble the full ledger for a user ---------- */
/**
 * v9: delegates to assembleLedgerRaw in neon-sql.ts.
 * Kept here for backward compatibility with existing route imports.
 */
export async function assembleLedger(userId: string): Promise<ReturnType<typeof assembleLedgerRaw>> {
  return assembleLedgerRaw(userId)
}

/* ---------- the merge contract, server-side ----------
 * activities append (same goal/day = hours add), habits/metrics set per-key,
 * checkIn/highlight replace, notes append. Nothing is ever deleted. */
export async function applyMergeDelta(userId: string, raw: MergeDelta): Promise<MergeResult> {
  const skipped: string[] = []
  const counts = { activities: 0, habits: 0, metrics: 0, notes: 0, highlight: 0, checkIn: 0 }

  const date = validDateStr(raw.date) ? raw.date : todayStr()
  const dayDate = s2d(date)

  /* resolve activities against known goals (fuzzy) */
  const goals = await findGoalsByUser(userId)
  const fuzzyGoal = (q: string | null | undefined) => {
    if (!q) return null
    const s = q.trim().toLowerCase()
    return (
      goals.find((g) => g.id.toLowerCase() === s) ??
      goals.find((g) => g.name.toLowerCase() === s) ??
      goals.find((g) => g.name.toLowerCase().includes(s) || s.includes(g.name.toLowerCase())) ??
      goals.find((g) => g.id.toLowerCase().includes(s) || s.includes(g.id.toLowerCase())) ??
      null
    )
  }
  const habits = await findHabitsByUser(userId)
  const metrics = await findMetricsByUser(userId)

  /* validate activities */
  const activities: Array<{ goalId: string | null; hours: number; start: string | null; end: string | null; label: string | null }> = []
  for (const [i, a] of (raw.activities ?? []).entries()) {
    if (!a || typeof a !== 'object') { skipped.push(`activity ${i + 1} — unreadable`); continue }
    const g = fuzzyGoal(a.goalId)
    if (a.goalId && !g) {
      skipped.push(`activity "${String(a.label ?? a.goalId).slice(0, 40)}" — unknown goal (have: ${goals.map((x) => x.id).join(', ')})`)
      continue
    }
    let start = validTimeStr(a.start) ? a.start : null
    let end = validTimeStr(a.end) ? a.end : null
    let hours = Number(a.hours)
    if (start && end) {
      const mins = Number(end.slice(0, 2)) * 60 + Number(end.slice(3)) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)))
      if (mins <= 0) { end = null } else { hours = +(mins / 60).toFixed(2) }
    }
    if (!(hours > 0 && hours <= 24)) hours = hours > 0 ? Math.min(24, hours) : 0.5
    activities.push({
      goalId: g ? g.id : null, hours,
      start, end,
      label: typeof a.label === 'string' && a.label.trim() ? a.label.trim().slice(0, 80) : null,
    })
  }

  /* validate habits */
  const habitRows: Array<{ habitId: string; done: boolean }> = []
  for (const h of raw.habits ?? []) {
    if (!h || typeof h !== 'object') continue
    const hb = habits.find((x) => x.id === (h.habitId ?? '').toLowerCase() || x.name.toLowerCase() === String(h.habitId ?? '').toLowerCase())
    if (!hb) { skipped.push(`habit "${String(h.habitId ?? '?').slice(0, 40)}" — unknown habit`); continue }
    habitRows.push({ habitId: hb.id, done: h.done !== false })
  }

  /* validate metrics */
  const metricRows: Array<{ metricId: string; value: number }> = []
  for (const m of raw.metrics ?? []) {
    if (!m || typeof m !== 'object') continue
    const mt = metrics.find((x) => x.id === (m.metricId ?? '').toLowerCase() || x.name.toLowerCase() === String(m.metricId ?? '').toLowerCase())
    if (!mt || typeof m.value !== 'number') { skipped.push(`metric "${String(m.metricId ?? '?').slice(0, 30)}" — unknown`); continue }
    metricRows.push({ metricId: mt.id, value: +m.value.toFixed(1) })
  }

  /* apply — day first (upsert) */
  const highlight = typeof raw.highlight === 'string' && raw.highlight.trim() ? raw.highlight.trim().slice(0, 200) : null
  const checkIn =
    raw.checkIn && typeof raw.checkIn === 'object' && String(raw.checkIn.answer ?? '').trim()
      ? { question: String(raw.checkIn.question ?? 'What mattered today?').slice(0, 120), answer: String(raw.checkIn.answer).slice(0, 200) }
      : null

  const patch: { highlight?: string | null; checkIn?: object | null } = {}
  if (highlight) { patch.highlight = highlight; counts.highlight = 1 }
  if (checkIn) { patch.checkIn = checkIn; counts.checkIn = 1 }

  await upsertDay(userId, dayDate, patch)

  if (activities.length) {
    for (const a of activities) {
      await createActivity({
        id: generateId(),
        userId,
        date: dayDate,
        goalId: a.goalId,
        hours: a.hours,
        start: a.start,
        end: a.end,
        label: a.label,
      })
    }
    counts.activities = activities.length
  }

  for (const h of habitRows) {
    await upsertDayHabit(userId, dayDate, h.habitId, h.done)
    counts.habits++
  }

  for (const m of metricRows) {
    await upsertDayMetric(userId, dayDate, m.metricId, m.value)
    counts.metrics++
  }

  const newNotes = (raw.newNotes ?? [])
    .map((n) => (typeof n === 'string' ? n.trim().slice(0, 300) : ''))
    .filter(Boolean)
  if (newNotes.length) {
    for (const text of newNotes) {
      await createNote({ id: generateId(), userId, date: dayDate, text })
    }
    counts.notes = newNotes.length
  }

  return { counts, skipped }
}
