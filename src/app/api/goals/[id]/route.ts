import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { findGoalByUserAndId, updateGoal, assembleLedgerRaw } from '@/lib/neon-sql'
import { validDateStr } from '@/lib/server/ledger'
import type { Milestone } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/goals/[id]
 * v9: uses raw SQL.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const goal = await findGoalByUserAndId(user.id, id)
  if (!goal) return jsonError(404, 'goal not found')

  const patch: {
    name?: string
    target?: number
    weeklyTargetHours?: number
    color?: string | null
    deadline?: Date | null
    milestones?: Milestone[]
  } = {}

  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 80)
  if (typeof body.target === 'number' && body.target > 0) patch.target = body.target
  if (typeof body.weeklyTargetHours === 'number' && body.weeklyTargetHours > 0 && body.weeklyTargetHours < 200) patch.weeklyTargetHours = body.weeklyTargetHours
  if (typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)) patch.color = body.color
  if (body.deadline === null) patch.deadline = null
  else if (validDateStr(body.deadline)) patch.deadline = new Date(body.deadline + 'T00:00:00Z')
  if (Array.isArray(body.milestones)) {
    patch.milestones = body.milestones
      .filter((m): m is Milestone => !!m && typeof m === 'object' && typeof (m as Milestone).label === 'string')
      .map((m) => ({ label: m.label.slice(0, 120), done: !!m.done }))
  }

  await updateGoal(user.id, id, patch)
  return Response.json({ ledger: await assembleLedgerRaw(user.id) })
}
