import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { findNoteByUserAndId, deleteNote, assembleLedgerRaw } from '@/lib/neon-sql'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/notes/[id]
 * v9: uses raw SQL.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  const { id } = await params
  const note = await findNoteByUserAndId(user.id, id)
  if (!note) return jsonError(404, 'note not found')
  await deleteNote(note.id)
  return Response.json({ ledger: await assembleLedgerRaw(user.id) })
}
