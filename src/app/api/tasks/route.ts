import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { findGoalByUserAndId, createTask, assembleLedgerRaw } from '@/lib/neon-sql'
import { todayStr } from '@/lib/server/ledger'
import { generateId } from '@/lib/server/cuid'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tasks
 * v9: uses raw SQL.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  let body: { goalId?: string; label?: string; priority?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const label = String(body.label ?? '').trim()
  const goalId = String(body.goalId ?? '').trim()
  if (!label) return jsonError(400, 'Give the task a label.')
  const goal = await findGoalByUserAndId(user.id, goalId)
  if (!goal) return jsonError(404, 'unknown goal')

  const priority = body.priority === 'high' ? 'high' : 'normal'
  await createTask({
    id: generateId(),
    userId: user.id,
    goalId,
    label: label.slice(0, 160),
    priority,
    urgent: priority === 'high',
    important: true,
    lastTouched: new Date(todayStr() + 'T00:00:00Z'),
  })
  return Response.json({ ledger: await assembleLedgerRaw(user.id) })
}
