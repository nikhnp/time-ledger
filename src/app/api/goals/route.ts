import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { findGoalByUserAndId, findGoalsByUser, createGoal as createGoalRow, maxChangeId, respondMutation } from '@/lib/neon-sql'
import { generateId } from '@/lib/server/cuid'

export const dynamic = 'force-dynamic'

/** Slugify a goal name into a human-friendly id ("Deep Work" → "deep-work"). */
function slugify(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return base || generateId().slice(0, 10)
}

/** POST /api/goals — create a goal (or a hobby — P2-2) for the current user. */
export async function POST(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  let body: { name?: string; target?: number; unit?: string; weeklyTargetHours?: number; kind?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const name = String(body.name ?? '').trim().slice(0, 60)
  if (!name) return jsonError(400, 'Give the goal a name.')

  const target = Math.max(1, Math.min(10000, Number(body.target) || 30))
  const unit = String(body.unit ?? 'hours').slice(0, 16)
  const weeklyTargetHours = Math.max(0.5, Math.min(80, Number(body.weeklyTargetHours) || 8))
  // P2-2: hobbies ride the Goal model — everything goals have, minus the
  // deadline pressure. Soft cap of 8 keeps the Today strip honest.
  const kind = body.kind === 'hobby' ? 'hobby' : 'goal'
  if (kind === 'hobby') {
    const existing = await findGoalsByUser(me.id)
    if (existing.filter((g) => g.kind === 'hobby').length >= 8) {
      return jsonError(400, 'Eight hobbies is plenty — archive or swap one first.')
    }
  }

  /* unique slug per user */
  let id = slugify(name)
  if (await findGoalByUserAndId(me.id, id)) {
    for (let i = 2; i < 50; i++) {
      const candidate = `${id}-${i}`
      if (!(await findGoalByUserAndId(me.id, candidate))) { id = candidate; break }
    }
  }

  const existing = await findGoalsByUser(me.id)
  const sinceId = await maxChangeId()
  await createGoalRow({
    userId: me.id,
    id,
    name,
    unit,
    target,
    weeklyTargetHours,
    sortOrder: existing.length,
    kind,
  })

  return respondMutation(me.id, sinceId)
}
