import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { findInboxItemByUserAndId, markInboxItemDone, deleteInboxItem, maxChangeId, respondMutation } from '@/lib/neon-sql'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/inbox/[id]  — marks the item as done (used by inboxToTask/inboxToNote)
 * DELETE /api/inbox/[id] — deletes the item
 * P2-1: done items leave ledger.inbox (assembly filters done:false), so both
 * handlers surface as deletes to delta clients.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { id } = await params
  const item = await findInboxItemByUserAndId(user.id, id)
  if (!item) return jsonError(404, 'item not found')
  const sinceId = await maxChangeId()
  await markInboxItemDone(item.id)
  return respondMutation(user.id, sinceId)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { id } = await params
  const item = await findInboxItemByUserAndId(user.id, id)
  if (!item) return jsonError(404, 'item not found')
  const sinceId = await maxChangeId()
  await deleteInboxItem(item.id)
  return respondMutation(user.id, sinceId)
}
