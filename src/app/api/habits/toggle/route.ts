import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { findHabitByUserAndId, findDayHabit, upsertDayHabit, maxChangeId, respondMutation } from '@/lib/neon-sql'
import { validDateStr } from '@/lib/server/ledger'
import { todayIn } from '@/lib/dates'

export const dynamic = 'force-dynamic'

/**
 * POST /api/habits/toggle
 * v9: uses raw SQL.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  let body: { habitId?: string; date?: string; done?: boolean }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const habitId = String(body.habitId ?? '')
  const habit = await findHabitByUserAndId(user.id, habitId)
  if (!habit) return jsonError(404, 'unknown habit')

  // P1-5: dateless toggles land on the user's local day
  const dateStr = validDateStr(body.date) ? body.date : todayIn(user.tz)
  const date = new Date(dateStr + 'T00:00:00Z')
  const existing = await findDayHabit(user.id, date, habitId)
  const done = typeof body.done === 'boolean' ? body.done : !(existing?.done ?? false)

  const sinceId = await maxChangeId()
  await upsertDayHabit(user.id, date, habitId, done)
  return respondMutation(user.id, sinceId, { done })
}
