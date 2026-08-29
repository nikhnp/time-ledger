import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { findDayByUserAndDate, upsertDay, maxChangeId, respondMutation } from '@/lib/neon-sql'
import { validDateStr, s2d } from '@/lib/server/ledger'
import type { DayPlanEntry } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/days/[date] — P2-3: edit `highlight` and `checkIn` (the missing
 * editor) and P2-4: write `plan` (tomorrow's intents).
 * Explicit null CLEARS a field; omitting it leaves it untouched. `plan` is a
 * JSON array of {goalId, hours, note} — a suggestion, never an auto-write.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { date } = await params
  if (!validDateStr(date)) return jsonError(400, 'Need a real date (YYYY-MM-DD).')
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const dayDate = s2d(date)
  await findDayByUserAndDate(user.id, dayDate) // existence is irrelevant — upsert creates

  const patch: { highlight?: string | null; checkIn?: object | null; plan?: object | null } = {}

  if (body.highlight !== undefined) {
    if (body.highlight === null) patch.highlight = null
    else if (typeof body.highlight === 'string' && body.highlight.trim()) patch.highlight = body.highlight.trim().slice(0, 200)
    else return jsonError(400, 'highlight must be a non-empty string or null')
  }
  if (body.checkIn !== undefined) {
    if (body.checkIn === null) {
      patch.checkIn = null
    } else if (body.checkIn && typeof body.checkIn === 'object') {
      const ci = body.checkIn as { question?: unknown; answer?: unknown }
      const answer = String(ci.answer ?? '').trim()
      if (!answer) return jsonError(400, 'checkIn needs an answer.')
      patch.checkIn = {
        question: String(ci.question ?? 'What mattered today?').slice(0, 120),
        answer: answer.slice(0, 200),
      }
    } else {
      return jsonError(400, 'checkIn must be an object or null.')
    }
  }
  if (body.plan !== undefined) {
    if (body.plan === null) {
      patch.plan = null
    } else if (Array.isArray(body.plan)) {
      // P2-4 discipline: {goalId, hours} pairs, ≤8 intents, hours ≤ 24 each
      const entries: DayPlanEntry[] = []
      for (const raw of body.plan.slice(0, 8)) {
        if (!raw || typeof raw !== 'object') continue
        const e = raw as Record<string, unknown>
        const hours = Number(e.hours)
        if (!(hours > 0 && hours <= 24)) continue
        entries.push({
          goalId: typeof e.goalId === 'string' && e.goalId.trim() ? e.goalId.trim().slice(0, 60) : null,
          hours: +hours.toFixed(2),
          ...(typeof e.note === 'string' && e.note.trim() ? { note: e.note.trim().slice(0, 120) } : {}),
        })
      }
      patch.plan = entries
    } else {
      return jsonError(400, 'plan must be an array or null.')
    }
  }

  if (Object.keys(patch).length === 0) return jsonError(400, 'Nothing to change.')

  const sinceId = await maxChangeId()
  await upsertDay(user.id, dayDate, patch)
  return respondMutation(user.id, sinceId)
}
