import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { findGoalByUserAndId, createTask, maxChangeId, respondMutation } from '@/lib/neon-sql'
import { todayIn } from '@/lib/dates'
import { generateId } from '@/lib/server/cuid'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tasks
 * v10.5: goalId is optional (unassigned tasks allowed); callers may set the
 * starting status and the urgent/important quadrant flags directly.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  let body: { goalId?: string | null; label?: string; priority?: string; status?: string; urgent?: boolean; important?: boolean }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const label = String(body.label ?? '').trim()
  if (!label) return jsonError(400, 'Give the task a label.')

  const rawGoal = typeof body.goalId === 'string' ? body.goalId.trim() : ''
  let goalId: string | null = null
  if (rawGoal) {
    const goal = await findGoalByUserAndId(user.id, rawGoal)
    if (!goal) return jsonError(404, 'unknown goal')
    goalId = rawGoal
  }

  const priority = body.priority === 'high' ? 'high' : 'normal'
  const status = body.status === 'doing' || body.status === 'done' ? body.status : 'todo'
  const sinceId = await maxChangeId()
  await createTask({
    id: generateId(),
    userId: user.id,
    goalId,
    label: label.slice(0, 160),
    priority,
    status,
    urgent: typeof body.urgent === 'boolean' ? body.urgent : priority === 'high',
    important: typeof body.important === 'boolean' ? body.important : true,
    lastTouched: new Date(todayIn(user.tz) + 'T00:00:00Z'),
  })
  return respondMutation(user.id, sinceId)
}
