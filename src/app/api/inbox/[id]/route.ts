import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { findInboxItemByUserAndId, markInboxItemDone, deleteInboxItem, assembleLedgerRaw } from '@/lib/neon-sql'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/inbox/[id]  — marks the item as done (used by inboxToTask/inboxToNote)
 * DELETE /api/inbox/[id] — deletes the item
 * v9: uses raw SQL.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { id } = await params
  const item = await findInboxItemByUserAndId(user.id, id)
  if (!item) return jsonError(404, 'item not found')
  await markInboxItemDone(item.id)
  return Response.json({ ledger: await assembleLedgerRaw(user.id) })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { id } = await params
  const item = await findInboxItemByUserAndId(user.id, id)
  if (!item) return jsonError(404, 'item not found')
  await deleteInboxItem(item.id)
  return Response.json({ ledger: await assembleLedgerRaw(user.id) })
}
