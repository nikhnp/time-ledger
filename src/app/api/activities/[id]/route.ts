import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import {
  findActivityByUserAndId,
  findGoalByUserAndId,
  updateActivity,
  deleteActivity,
  maxChangeId,
  respondMutation,
} from '@/lib/neon-sql'
import { validDateStr } from '@/lib/server/ledger'
import { normalizeActivityTimes, cleanLabel } from '@/lib/server/validate'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/activities/[id] — P2-3: correct the record.
 * A typo'd 3.5h entry no longer lives forever and silently corrupts every
 * aggregate. Validation reuses the exact merge-pipeline rules (extracted to
 * src/lib/server/validate.ts). Sets Activity.updatedAt; createdAt untouched.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const existing = await findActivityByUserAndId(user.id, id)
  if (!existing) return jsonError(404, 'activity not found')

  const patch: {
    date?: Date
    goalId?: string | null
    hours?: number
    start?: string | null
    end?: string | null
    label?: string | null
  } = {}

  if (body.date !== undefined) {
    if (!validDateStr(body.date)) return jsonError(400, 'Need a real date (YYYY-MM-DD).')
    patch.date = new Date(body.date + 'T00:00:00Z')
  }
  if (body.goalId !== undefined) {
    if (body.goalId === null) {
      patch.goalId = null
    } else if (typeof body.goalId === 'string') {
      const goal = await findGoalByUserAndId(user.id, body.goalId)
      if (!goal) return jsonError(404, 'unknown goal')
      patch.goalId = goal.id
    }
  }
  /* times normalize with the same rules as capture (start/end → hours etc.) */
  if (body.hours !== undefined || body.start !== undefined || body.end !== undefined) {
    const t = normalizeActivityTimes({
      hours: body.hours !== undefined ? Number(body.hours) : existing.hours,
      start: body.start !== undefined ? (body.start as string | null) : existing.start,
      end: body.end !== undefined ? (body.end as string | null) : existing.end,
    })
    patch.hours = t.hours
    patch.start = t.start
    patch.end = t.end
  }
  if (body.label !== undefined) patch.label = cleanLabel(body.label)

  if (Object.keys(patch).length === 0) return jsonError(400, 'Nothing to change.')

  const sinceId = await maxChangeId()
  await updateActivity(user.id, id, patch)
  return respondMutation(user.id, sinceId)
}

/**
 * DELETE /api/activities/[id] — P2-3: hard delete with confirm upstream
 * (soft-delete is ceremony without a consumer; the admin backup covers regret).
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { id } = await params
  const existing = await findActivityByUserAndId(user.id, id)
  if (!existing) return jsonError(404, 'activity not found')
  const sinceId = await maxChangeId()
  await deleteActivity(user.id, id)
  return respondMutation(user.id, sinceId)
}
