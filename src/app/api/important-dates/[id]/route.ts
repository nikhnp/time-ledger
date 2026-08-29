import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import {
  findImportantDateByUserAndId,
  updateImportantDate,
  deleteImportantDate,
  maxChangeId,
  respondMutation,
} from '@/lib/neon-sql'
import { validDateStr } from '@/lib/server/ledger'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/important-dates/[id] — P2-3/P2-9: important dates were
 * create-only, so a parsed-wrong date could never be fixed in place.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const existing = await findImportantDateByUserAndId(user.id, id)
  if (!existing) return jsonError(404, 'date not found')

  const patch: { label?: string; date?: Date; type?: string } = {}
  if (typeof body.label === 'string' && body.label.trim()) patch.label = body.label.trim().slice(0, 120)
  if (body.date !== undefined) {
    if (!validDateStr(body.date)) return jsonError(400, 'Need a real date (YYYY-MM-DD).')
    patch.date = new Date(body.date + 'T00:00:00Z')
  }
  if (typeof body.type === 'string' && ['deadline', 'birthday', 'reminder', 'event'].includes(body.type)) {
    patch.type = body.type
  }
  if (Object.keys(patch).length === 0) return jsonError(400, 'Nothing to change.')

  const sinceId = await maxChangeId()
  await updateImportantDate(user.id, id, patch)
  return respondMutation(user.id, sinceId)
}

/** DELETE /api/important-dates/[id] — P2-3. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { id } = await params
  const existing = await findImportantDateByUserAndId(user.id, id)
  if (!existing) return jsonError(404, 'date not found')
  const sinceId = await maxChangeId()
  await deleteImportantDate(user.id, id)
  return respondMutation(user.id, sinceId)
}
