import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { findHabitByUserAndId, findDayHabit, upsertDayHabit, assembleLedgerRaw } from '@/lib/neon-sql'
import { assembleLedger, todayStr, validDateStr } from '@/lib/server/ledger'

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

  const dateStr = validDateStr(body.date) ? body.date : todayStr()
  const date = new Date(dateStr + 'T00:00:00Z')
  const existing = await findDayHabit(user.id, date, habitId)
  const done = typeof body.done === 'boolean' ? body.done : !(existing?.done ?? false)

  await upsertDayHabit(user.id, date, habitId, done)
  return Response.json({ ledger: await assembleLedger(user.id), done })
}
