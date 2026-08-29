import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { findNoteByUserAndId, updateNote, deleteNote, maxChangeId, respondMutation } from '@/lib/neon-sql'
import { validDateStr } from '@/lib/server/ledger'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/notes/[id] — P2-3: note editing (the audit's "append-only feels
 * like a demo" fix). Text only; the note keeps its id and day unless `date`
 * is explicitly moved.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { id } = await params
  let body: { text?: string; date?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const note = await findNoteByUserAndId(user.id, id)
  if (!note) return jsonError(404, 'note not found')

  const patch: { text?: string; date?: Date } = {}
  if (typeof body.text === 'string' && body.text.trim()) patch.text = body.text.trim().slice(0, 300)
  if (body.date !== undefined) {
    if (!validDateStr(body.date)) return jsonError(400, 'Need a real date (YYYY-MM-DD).')
    patch.date = new Date(body.date + 'T00:00:00Z')
  }
  if (Object.keys(patch).length === 0) return jsonError(400, 'Nothing to change.')

  const sinceId = await maxChangeId()
  await updateNote(user.id, note.id, patch)
  return respondMutation(user.id, sinceId)
}

/**
 * DELETE /api/notes/[id]
 * P2-1: responds with a per-entity patch + cursor instead of the full ledger.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { id } = await params
  const note = await findNoteByUserAndId(user.id, id)
  if (!note) return jsonError(404, 'note not found')
  const sinceId = await maxChangeId()
  await deleteNote(note.id)
  return respondMutation(user.id, sinceId)
}
