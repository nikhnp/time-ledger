import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { findTaskByUserAndId, findGoalByUserAndId, updateTask, deleteTask, maxChangeId, respondMutation } from '@/lib/neon-sql'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/tasks/[id]
 * DELETE /api/tasks/[id]
 * P2-1: responds with a per-entity patch + cursor instead of the full ledger.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const task = await findTaskByUserAndId(user.id, id)
  if (!task) return jsonError(404, 'task not found')

  const patch: {
    label?: string
    status?: string
    priority?: string
    urgent?: boolean
    important?: boolean
    goalId?: string
    lastTouched?: Date
  } = { lastTouched: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z') }

  if (typeof body.label === 'string' && body.label.trim()) patch.label = body.label.trim().slice(0, 160)
  if (body.status === 'todo' || body.status === 'doing' || body.status === 'done') patch.status = body.status
  if (body.priority === 'high' || body.priority === 'normal') patch.priority = body.priority
  if (typeof body.urgent === 'boolean') patch.urgent = body.urgent
  if (typeof body.important === 'boolean') patch.important = body.important
  if (typeof body.goalId === 'string' && body.goalId !== task.goalId) {
    const goal = await findGoalByUserAndId(user.id, body.goalId)
    if (!goal) return jsonError(404, 'unknown goal')
    patch.goalId = body.goalId
  }

  const sinceId = await maxChangeId()
  await updateTask(task.id, patch)
  return respondMutation(user.id, sinceId)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { id } = await params
  const task = await findTaskByUserAndId(user.id, id)
  if (!task) return jsonError(404, 'task not found')
  const sinceId = await maxChangeId()
  await deleteTask(task.id)
  return respondMutation(user.id, sinceId)
}
