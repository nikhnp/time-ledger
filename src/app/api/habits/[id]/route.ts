import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { findHabitByUserAndId, updateHabit, deleteHabit, assembleLedgerRaw } from '@/lib/neon-sql'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/habits/[id] — v10.5
 * Rename / retarget / archive / unarchive a habit. Archived habits keep
 * their history but stop appearing in active lists.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { id } = await params
  if (!(await findHabitByUserAndId(user.id, id))) return jsonError(404, 'habit not found')

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const patch: {
    name?: string
    targetPerWeek?: number
    archived?: boolean
  } = {}

  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 60)
  if (typeof body.targetPerWeek === 'number' && body.targetPerWeek >= 1 && body.targetPerWeek <= 7) {
    patch.targetPerWeek = Math.round(body.targetPerWeek)
  }
  if (typeof body.archived === 'boolean') patch.archived = body.archived

  await updateHabit(user.id, id, patch)
  return Response.json({ ledger: await assembleLedgerRaw(user.id) })
}

/**
 * DELETE /api/habits/[id] — v10.5
 * Permanently removes the habit and its per-day check history.
 * Prefer PATCH { archived: true } for habits you might come back to.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { id } = await params
  if (!(await findHabitByUserAndId(user.id, id))) return jsonError(404, 'habit not found')

  await deleteHabit(user.id, id)
  return Response.json({ ledger: await assembleLedgerRaw(user.id) })
}
