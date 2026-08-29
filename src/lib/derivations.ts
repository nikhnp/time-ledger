/* Derivations — every view is a pure function of the ledger. Ported from the prototype's core.js. */
import type { Ledger, DayT, TaskT, GoalT, DayPlanEntry } from './types'
import { isoLocal, isoDaysAgo, isoMonthOf, s2d, d2s, todayStr, daysUntil, daysSince, currentWeekDates } from './dates'
import { STALE_DAYS } from './colors'

export const L = {
  day: (ledger: Ledger, s: string): DayT | undefined => ledger.days.find((d) => d.date === s),
  goalName: (ledger: Ledger, gid: string | null): string => {
    if (!gid) return 'No goal'
    const g = ledger.goals.find((x) => x.id === gid)
    return g ? g.name : gid
  },
}

export function goalCurrent(ledger: Ledger, gid: string): number {
  return ledger.days.reduce(
    (s, d) => s + d.activities.filter((a) => a.goalId === gid).reduce((x, a) => x + a.hours, 0), 0)
}

export function goalWeekHours(ledger: Ledger, gid: string): number {
  const wk = new Set(currentWeekDates())
  return ledger.days.reduce(
    (s, d) => (wk.has(d.date) ? s + d.activities.filter((a) => a.goalId === gid).reduce((x, a) => x + a.hours, 0) : s), 0)
}

export function metricToday(ledger: Ledger, mid: string): number {
  const d = L.day(ledger, todayStr())
  return d ? (d.metrics[mid] ?? 0) : 0
}

export function currentStreak(ledger: Ledger): number {
  let n = 0
  const c = new Date()
  for (;;) {
    const d = L.day(ledger, isoLocal(c))
    if (d && d.activities.length) { n++; c.setUTCDate(c.getUTCDate() - 1) } else break
  }
  return n
}

export function totalHoursAllTime(ledger: Ledger): number {
  return ledger.days.reduce((s, d) => s + d.activities.reduce((x, a) => x + a.hours, 0), 0)
}

export function tasksDoneThisWeek(ledger: Ledger): number {
  let n = 0
  ledger.tasks.forEach((t) => {
    if (t.status === 'done' && daysSince(t.lastTouched) <= 7) n++
  })
  return n
}

export function habitDoneOn(ledger: Ledger, hid: string, s: string): boolean {
  return !!(L.day(ledger, s)?.habits[hid])
}

export function habitStreak(ledger: Ledger, hid: string): number {
  let n = 0
  const c = new Date()
  for (;;) {
    if (habitDoneOn(ledger, hid, isoLocal(c))) { n++; c.setUTCDate(c.getUTCDate() - 1) } else break
  }
  return n
}

export function habitWeekDots(ledger: Ledger, hid: string): boolean[] {
  const a: boolean[] = []
  for (let i = 6; i >= 0; i--) a.push(habitDoneOn(ledger, hid, isoDaysAgo(i)))
  return a
}

export interface PriorityTask {
  goalId: string | null
  goalName: string
  task: TaskT
  idle: number
}

export function priorityTasks(ledger: Ledger): PriorityTask[] {
  const l: PriorityTask[] = []
  allTasks(ledger).forEach(({ goalId, goalName, task: t }) => {
    if (t.status === 'done') return
    const idle = daysSince(t.lastTouched)
    if (t.priority === 'high' || idle >= STALE_DAYS) l.push({ goalId, goalName, task: t, idle })
  })
  l.sort((a, b) => {
    const ah = a.task.priority === 'high'
    const bh = b.task.priority === 'high'
    if (ah !== bh) return ah ? -1 : 1
    return b.idle - a.idle
  })
  return l
}

export interface DeadlineItem {
  label: string
  date: string
  du: number
  /** P2-3: importantDate rows are editable in place; goal deadlines are not. */
  id?: string
  source: 'goal' | 'date'
}

export function upcomingDeadlines(ledger: Ledger): DeadlineItem[] {
  const items: DeadlineItem[] = []
  ledger.goals.forEach((g) => { if (g.deadline) items.push({ label: g.name, date: g.deadline, du: 0, source: 'goal' }) })
  ledger.importantDates.forEach((d) => items.push({ label: d.label, date: d.date, du: 0, id: d.id, source: 'date' }))
  return items
    .map((i) => ({ ...i, du: daysUntil(i.date) ?? 0 }))
    .sort((a, b) => a.du - b.du)
    .slice(0, 6)
}

export function focusScore(ledger: Ledger, s: string): number {
  const d = L.day(ledger, s)
  if (!d || !d.activities.length) return 0
  const t = d.activities.reduce((x, a) => x + a.hours, 0)
  return Math.round(100 * Math.min(1, t / 6))
}

export function isFlagged(text: string): boolean {
  return /deadline|due|birthday|remind|appointment|renew|expir|anniversar/i.test(text)
}

/* ---------- recommendation engine (the opinionated part) ---------- */

export interface Recommendation {
  w: number
  icon: string
  color: string
  tag: string
  text: string
}

export function getRecommendations(ledger: Ledger): Recommendation[] {
  const R: Recommendation[] = []
  const t = todayStr()
  const day = L.day(ledger, t)
  const logged = !!(day && day.activities.length)

  const st = currentStreak(ledger)
  if (st >= 3 && !logged) {
    R.push({
      w: 100, icon: 'flame', color: 'var(--accent)', tag: 'TONIGHT',
      text: `Your <strong>${st}-day streak</strong> dies tonight if nothing gets logged. Thirty minutes saves it.`,
    })
  }

  const pt = priorityTasks(ledger)[0]
  if (pt) {
    R.push({
      w: 90, icon: 'flag', color: 'var(--accent)',
      tag: pt.idle >= STALE_DAYS ? `${pt.idle} DAYS IDLE` : 'TODAY',
      text: `<strong>${esc(pt.task.label)}</strong>. ${pt.idle >= 1 ? `Untouched for ${pt.idle} day${pt.idle > 1 ? 's' : ''}. ` : ''}Do it first or drop it — no middle ground.`,
    })
  }

  const dl = upcomingDeadlines(ledger).find((d) => d.du > 0 && d.du <= 14)
  if (dl) {
    R.push({
      w: 80, icon: 'calendar', color: 'var(--warn)', tag: `${dl.du} DAYS`,
      text: `<strong>${esc(dl.label)}</strong> in ${dl.du} days. Prep now or panic the night before.`,
    })
  }

  for (const g of ledger.goals) {
    if (!g.deadline) continue
    const du = daysUntil(g.deadline) ?? 0
    const cur = goalCurrent(ledger, g.id)
    const elapsed = daysSince(ledger.meta.startDate)
    const total = elapsed + Math.max(0, du)
    const expected = g.target * (elapsed / Math.max(1, total))
    const behind = expected - cur
    if (behind > 1) {
      R.push({
        w: 70, icon: 'target', color: 'var(--chart-4)', tag: 'BEHIND PACE',
        text: `<strong>${esc(g.name)}</strong> is ${behind.toFixed(1)}h behind pace with ${du}d left. ~${(behind / Math.max(1, du)).toFixed(1)}h a day — tight, not impossible.`,
      })
      break
    }
  }

  for (const h of ledger.habits) {
    if (h.archived) continue
    const wk = habitWeekDots(ledger, h.id).filter(Boolean).length
    if (wk < h.targetPerWeek) {
      R.push({
        w: 60, icon: 'check', color: 'var(--warn)', tag: 'THIS WEEK',
        text: `<strong>${esc(h.name)}</strong>: ${wk}/${h.targetPerWeek} this week. ${h.targetPerWeek - wk} to go. Future-you is watching.`,
      })
      break
    }
  }

  for (const m of ledger.metrics) {
    const v = metricToday(ledger, m.id)
    if (m.direction === 'down' && v > (m.dailyTarget ?? Infinity)) {
      R.push({
        w: 50, icon: 'phone', color: 'var(--chart-5)', tag: 'OVER TODAY',
        text: `<strong>${esc(m.name)}</strong> at ${v}${m.unit} against a ${m.dailyTarget}${m.unit} target. The drawer exists. Use it.`,
      })
      break
    }
  }

  R.sort((a, b) => b.w - a.w)
  return R.slice(0, 4)
}

/* ---------- weeks & months ---------- */

export interface WeekRange {
  start: Date
  end: Date
}

export function allWeeks(ledger: Ledger): WeekRange[] {
  const earliest = ledger.days[0]?.date ?? todayStr()
  const e = s2d(earliest)
  const fd = new Date(e)
  fd.setUTCDate(fd.getUTCDate() - ((fd.getUTCDay() + 6) % 7))
  const now = s2d(todayStr())
  const ld = new Date(now)
  ld.setUTCDate(ld.getUTCDate() + (6 - ((ld.getUTCDay() + 6) % 7)))
  const weeks: WeekRange[] = []
  const d = new Date(fd)
  while (d <= ld) {
    const s = new Date(d)
    const en = new Date(d)
    en.setUTCDate(en.getUTCDate() + 6)
    weeks.push({ start: s, end: en })
    d.setUTCDate(d.getUTCDate() + 7)
  }
  return weeks
}

export function weekDates(w: WeekRange): string[] {
  const a: string[] = []
  const d = new Date(w.start)
  while (d <= w.end) { a.push(d2s(d)); d.setUTCDate(d.getUTCDate() + 1) }
  return a
}

export function monthList(ledger: Ledger): string[] {
  const set = new Set(ledger.days.map((d) => isoMonthOf(d.date)))
  set.add(isoMonthOf(todayStr()))
  return Array.from(set).sort()
}

export function monthDays(ledger: Ledger, m: string): DayT[] {
  return ledger.days.filter((d) => isoMonthOf(d.date) === m)
}

export function monthLabel(s: string): string {
  const [y, m] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function monthLong(s: string): string {
  const [y, m] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/* ---------- P2-2: pursuits (goals vs hobbies) ---------- */

export function goalsOf(ledger: Ledger): GoalT[] {
  return ledger.goals.filter((g) => (g.kind ?? 'goal') === 'goal')
}

export function hobbiesOf(ledger: Ledger): GoalT[] {
  return ledger.goals.filter((g) => g.kind === 'hobby')
}

/** This week's logged hours for one pursuit (hobby strip / goals tabs). */
export function weekHoursOf(ledger: Ledger, gid: string): number {
  return goalWeekHours(ledger, gid)
}

/* ---------- P2-4: the plan (tomorrow's intents) ---------- */

export function dayPlan(ledger: Ledger, date: string): DayPlanEntry[] {
  return L.day(ledger, date)?.plan ?? []
}

/* ---------- tasks / board / matrix ---------- */

export const STATUS_ORDER = ['todo', 'doing', 'done'] as const
export type Quadrant = 'q1' | 'q2' | 'q3' | 'q4'

export function quadrantOf(t: TaskT): Quadrant | null {
  if (t.status === 'done') return null
  if (t.urgent && t.important) return 'q1'
  if (!t.urgent && t.important) return 'q2'
  if (t.urgent && !t.important) return 'q3'
  return 'q4'
}

export interface TaskRef {
  goalId: string | null
  goalName: string
  task: TaskT
}

export function allTasks(ledger: Ledger): TaskRef[] {
  return ledger.tasks.map((t) => ({ goalId: t.goalId, goalName: L.goalName(ledger, t.goalId), task: t }))
}

export function fuzzyGoal(ledger: Ledger, raw: string | null | undefined): GoalT | null {
  if (!raw) return null
  const q = raw.trim().toLowerCase()
  return (
    ledger.goals.find((g) => g.id.toLowerCase() === q) ??
    ledger.goals.find((g) => g.name.toLowerCase() === q) ??
    ledger.goals.find((g) => g.name.toLowerCase().includes(q) || q.includes(g.name.toLowerCase())) ??
    ledger.goals.find((g) => g.id.toLowerCase().includes(q) || q.includes(g.id.toLowerCase())) ??
    null
  )
}

export function fuzzyHabit(ledger: Ledger, raw: string | null | undefined) {
  if (!raw) return null
  const q = raw.trim().toLowerCase()
  return (
    ledger.habits.find((h) => h.id.toLowerCase() === q) ??
    ledger.habits.find((h) => h.name.toLowerCase() === q) ??
    ledger.habits.find((h) => h.name.toLowerCase().includes(q) || q.includes(h.name.toLowerCase())) ??
    null
  )
}

/* ---------- delta validation (for the LLM preview, client-side) ---------- */

export interface ValidatedDelta {
  date: string
  highlight?: string
  checkIn?: { question: string; answer: string }
  activities: Array<{ goalId: string | null; hours: number; start?: string; end?: string; label?: string; clientId?: string }>
  habits: Array<{ habitId: string; done: boolean }>
  metrics: Array<{ metricId: string; value: number }>
  newNotes: Array<string | { text: string; clientId?: string }>
  dates: Array<{ label: string; date: string; type: 'deadline' | 'birthday' | 'reminder' | 'event'; clientId?: string }>
}

export function validateDelta(ledger: Ledger, raw: Record<string, unknown>): { delta: ValidatedDelta; skipped: string[] } {
  const skipped: string[] = []
  const d: ValidatedDelta = {
    date: validDate(raw.date) ? (raw.date as string) : todayStr(),
    activities: [], habits: [], metrics: [], newNotes: [], dates: [],
  }

  if (typeof raw.highlight === 'string' && raw.highlight.trim()) d.highlight = raw.highlight.trim().slice(0, 200)
  const ci = raw.checkIn as { question?: string; answer?: string } | undefined
  if (ci && typeof ci === 'object' && String(ci.answer ?? '').trim()) {
    d.checkIn = { question: String(ci.question ?? 'What mattered today?').slice(0, 120), answer: String(ci.answer).slice(0, 200) }
  }

  const acts = Array.isArray(raw.activities) ? raw.activities : []
  acts.forEach((a, i) => {
    if (!a || typeof a !== 'object') { skipped.push(`activity ${i + 1} — unreadable`); return }
    const o = a as Record<string, unknown>
    const g = fuzzyGoal(ledger, (o.goalId ?? o.goal) as string)
    if (o.goalId && !g) {
      skipped.push(`activity "${String(o.label ?? o.goalId ?? '?').slice(0, 40)}" — unknown goal (have: ${ledger.goals.map((x) => x.id).join(', ')})`)
      return
    }
    let start = validTime(o.start) ? (o.start as string) : undefined
    let end = validTime(o.end) ? (o.end as string) : undefined
    let hours = Number(o.hours)
    if (start && end) {
      const [sh, sm] = start.split(':').map(Number)
      const [eh, em] = end.split(':').map(Number)
      const mins = eh * 60 + em - (sh * 60 + sm)
      if (mins <= 0) end = undefined
      else hours = +(mins / 60).toFixed(2)
    }
    if (!(hours > 0 && hours <= 24)) hours = hours > 0 ? Math.min(24, hours) : 0.5
    d.activities.push({
      goalId: g ? g.id : null, hours, start, end,
      label: typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 80) : undefined,
    })
  })

  const habs = Array.isArray(raw.habits) ? raw.habits : []
  habs.forEach((h) => {
    if (!h || typeof h !== 'object') return
    const o = h as Record<string, unknown>
    const hb = fuzzyHabit(ledger, (o.habitId ?? o.habit ?? o.name) as string)
    if (!hb) { skipped.push(`habit "${String(o.habitId ?? '?').slice(0, 40)}" — unknown habit`); return }
    d.habits.push({ habitId: hb.id, done: o.done !== false })
  })

  const mets = Array.isArray(raw.metrics) ? raw.metrics : []
  mets.forEach((m) => {
    if (!m || typeof m !== 'object') return
    const o = m as Record<string, unknown>
    const mt = ledger.metrics.find((x) => x.id === o.metricId || x.name.toLowerCase() === String(o.metricId ?? '').toLowerCase())
    if (!mt || typeof o.value !== 'number') { skipped.push(`metric "${String(o.metricId ?? '?').slice(0, 30)}" — unknown`); return }
    d.metrics.push({ metricId: mt.id, value: +o.value.toFixed(1) })
  })

  const notes = Array.isArray(raw.newNotes) ? raw.newNotes : []
  notes.forEach((n) => {
    if (typeof n === 'string') {
      const s = n.trim()
      if (s) d.newNotes.push(s.slice(0, 300))
    } else if (n && typeof n === 'object') {
      const o = n as Record<string, unknown>
      const s = String(o.text ?? '').trim()
      if (s) d.newNotes.push({ text: s.slice(0, 300), ...(typeof o.clientId === 'string' ? { clientId: o.clientId } : {}) })
    }
  })

  /* P2-9: dated items ("deadline after exactly a week" → that day) */
  const dates = Array.isArray(raw.dates) ? raw.dates : []
  dates.forEach((dt) => {
    if (!dt || typeof dt !== 'object') { skipped.push('date — unreadable'); return }
    const o = dt as Record<string, unknown>
    const label = String(o.label ?? '').trim()
    if (!label) { skipped.push('date — no label'); return }
    if (!validDate(o.date)) { skipped.push(`date "${label.slice(0, 30)}" — not a real date`); return }
    const type = ['deadline', 'birthday', 'reminder', 'event'].includes(String(o.type))
      ? (String(o.type) as ValidatedDelta['dates'][number]['type'])
      : 'event'
    d.dates.push({ label: label.slice(0, 120), date: o.date as string, type })
  })

  return { delta: d, skipped }
}

function validDate(s: unknown): boolean {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z').getTime())
}
function validTime(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}

/* ---------- misc ---------- */

export function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}
