import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { findHabitByUserAndId, findHabitsByUser, createHabit as createHabitRow, assembleLedgerRaw } from '@/lib/neon-sql'
import { generateId } from '@/lib/server/cuid'

export const dynamic = 'force-dynamic'

/** Slugify a habit name into a human-friendly id ("Read before bed" → "read-before-bed"). */
function slugify(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return base || generateId().slice(0, 10)
}

/** POST /api/habits — create a habit for the current user. */
export async function POST(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  let body: { name?: string; targetPerWeek?: number }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const name = String(body.name ?? '').trim().slice(0, 60)
  if (!name) return jsonError(400, 'Give the habit a name.')

  const targetPerWeek = Math.max(1, Math.min(7, Math.round(Number(body.targetPerWeek) || 7)))

  let id = slugify(name)
  if (await findHabitByUserAndId(me.id, id)) {
    for (let i = 2; i < 50; i++) {
      const candidate = `${id}-${i}`
      if (!(await findHabitByUserAndId(me.id, candidate))) { id = candidate; break }
    }
  }

  const existing = await findHabitsByUser(me.id)
  await createHabitRow({
    userId: me.id,
    id,
    name,
    targetPerWeek,
    sortOrder: existing.length,
  })

  const ledger = await assembleLedgerRaw(me.id)
  return Response.json({ ledger })
}
