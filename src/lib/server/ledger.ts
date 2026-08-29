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
  findActivityByUserAndClientId,
  findNoteByUserAndClientId,
  logChanges,
  type Client,
} from '@/lib/neon-sql'
import { db } from '@/lib/db'
import { generateId } from '@/lib/server/cuid'
import { normalizeActivityTimes, cleanLabel } from '@/lib/server/validate'
import type { MergeDelta, MergeResult } from '@/lib/types'

/* ---------- date helpers (single source: @/lib/dates — P1-5) ----------
 * Re-exported for the routes that historically imported them from here. */
import { d2s, s2d, todayStr, validDateStr, validTimeStr } from '@/lib/dates'
export { d2s, s2d, todayStr, validDateStr, validTimeStr }

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
export async function applyMergeDelta(
  userId: string,
  raw: MergeDelta,
  opts?: { today?: string },
): Promise<MergeResult> {
  const skipped: string[] = []
  const counts = { activities: 0, habits: 0, metrics: 0, notes: 0, highlight: 0, checkIn: 0, dates: 0 }

  // P1-5: callers that know the user's zone pass it via opts.today so an
  // omitted date lands on the user's local day, not UTC's.
  const date = validDateStr(raw.date) ? raw.date : (opts?.today ?? todayStr())
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
  const activities: Array<{ goalId: string | null; hours: number; start: string | null; end: string | null; label: string | null; clientId: string | null }> = []
  for (const [i, a] of (raw.activities ?? []).entries()) {
    if (!a || typeof a !== 'object') { skipped.push(`activity ${i + 1} — unreadable`); continue }
    const g = fuzzyGoal(a.goalId)
    if (a.goalId && !g) {
      skipped.push(`activity "${String(a.label ?? a.goalId).slice(0, 40)}" — unknown goal (have: ${goals.map((x) => x.id).join(', ')})`)
      continue
    }
    const t = normalizeActivityTimes(a)
    activities.push({
      goalId: g ? g.id : null,
      hours: t.hours,
      start: t.start,
      end: t.end,
      label: cleanLabel(a.label),
      // P2-10: idempotency key — a replayed capture upserts instead of appending
      clientId: typeof a.clientId === 'string' && a.clientId.trim() ? a.clientId.trim().slice(0, 64) : null,
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

  /* apply — ONE transaction (P1-4): v10.3 wrote day, activities, habits,
   * metrics and notes as separate awaits; a mid-way failure left partial
   * days. Now everything below commits together or not at all. */
  const highlight = typeof raw.highlight === 'string' && raw.highlight.trim() ? raw.highlight.trim().slice(0, 200) : null
  const checkIn =
    raw.checkIn && typeof raw.checkIn === 'object' && String(raw.checkIn.answer ?? '').trim()
      ? { question: String(raw.checkIn.question ?? 'What mattered today?').slice(0, 120), answer: String(raw.checkIn.answer).slice(0, 200) }
      : null

  /* P2-9: dated items land on THEIR day ("deadline after exactly a week"),
   * not today's notes. Validated with the same discipline as the route. */
  const dateRows: Array<{ id: string; label: string; date: Date; type: string }> = []
  for (const [i, d] of (raw.dates ?? []).entries()) {
    if (!d || typeof d !== 'object') continue
    const label = cleanLabel(d.label, 120)
    if (!label || !validDateStr(d.date)) {
      skipped.push(`date ${i + 1} — needs a label and a real date`)
      continue
    }
    const type = ['deadline', 'birthday', 'reminder', 'event'].includes(String(d.type)) ? String(d.type) : 'event'
    dateRows.push({ id: generateId(), label, date: new Date(d.date + 'T00:00:00Z'), type })
  }
  if (dateRows.length) counts.dates = dateRows.length

  const patch: { highlight?: string | null; checkIn?: object | null } = {}
  if (highlight) { patch.highlight = highlight; counts.highlight = 1 }
  if (checkIn) { patch.checkIn = checkIn; counts.checkIn = 1 }

  await db.$transaction(async (tx) => {
    await upsertDay(userId, dayDate, patch, tx)

    if (activities.length) {
      for (const a of activities) {
        /* P2-10: a replayed capture (offline outbox) must not double-write.
         * Same (userId, clientId) already in the book → skip silently. */
        if (a.clientId && (await findActivityByUserAndClientId(userId, a.clientId))) continue
        await createActivity(
          {
            id: generateId(),
            userId,
            date: dayDate,
            goalId: a.goalId,
            hours: a.hours,
            start: a.start,
            end: a.end,
            label: a.label,
            clientId: a.clientId,
          },
          tx,
        )
      }
      counts.activities = activities.length
    }

    for (const h of habitRows) {
      await upsertDayHabit(userId, dayDate, h.habitId, h.done, tx)
      counts.habits++
    }

    for (const m of metricRows) {
      await upsertDayMetric(userId, dayDate, m.metricId, m.value, tx)
      counts.metrics++
    }

    /* P2-10: newNotes may carry a clientId per note ({ text, clientId }). */
    const newNotes = (raw.newNotes ?? [])
      .map((n) => {
        if (typeof n === 'string') return { text: n.trim().slice(0, 300), clientId: null as string | null }
        const text = String(n?.text ?? '').trim().slice(0, 300)
        const clientId = n && typeof n === 'object' && typeof n.clientId === 'string' && n.clientId.trim() ? n.clientId.trim().slice(0, 64) : null
        return { text, clientId }
      })
      .filter((n) => n.text)
    if (newNotes.length) {
      for (const n of newNotes) {
        if (n.clientId && (await findNoteByUserAndClientId(userId, n.clientId))) continue
        await createNote({ id: generateId(), userId, date: dayDate, text: n.text }, tx)
      }
      counts.notes = newNotes.length
    }

    if (dateRows.length) {
      for (const d of dateRows) {
        await tx.importantDate.create({ data: { ...d, userId, repeatsAnnually: false } })
      }
      await logChanges(
        tx,
        userId,
        dateRows.map((d) => ({ entity: 'importantDate' as const, entityId: d.id })),
      )
    }
  })

  return { counts, skipped }
}
