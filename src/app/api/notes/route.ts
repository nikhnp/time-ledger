import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { createNote, findNoteByUserAndClientId, maxChangeId, respondMutation } from '@/lib/neon-sql'
import { validDateStr } from '@/lib/server/ledger'
import { todayIn } from '@/lib/dates'
import { generateId } from '@/lib/server/cuid'

export const dynamic = 'force-dynamic'

/**
 * POST /api/notes
 * v9: uses raw SQL. P1-5: dateless notes land on the user's local day.
 * P2-10: an optional clientId makes a replayed offline capture a no-op —
 * the existing note is returned instead of a duplicate append.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  let body: { text?: string; date?: string; clientId?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }
  const text = String(body.text ?? '').trim()
  if (!text) return jsonError(400, 'Write something first.')
  // P1-5: dateless notes land on the user's local day
  const dateStr = validDateStr(body.date) ? body.date : todayIn(user.tz)
  const clientId = typeof body.clientId === 'string' && body.clientId.trim() ? body.clientId.trim().slice(0, 64) : null
  const sinceId = await maxChangeId()

  if (clientId) {
    const existing = await findNoteByUserAndClientId(user.id, clientId)
    if (existing) {
      // replay: re-serve the original row's patch — no duplicate row
      return respondMutation(user.id, sinceId, { noteId: existing.id })
    }
  }

  const noteId = generateId()
  await createNote({
    id: noteId,
    userId: user.id,
    date: new Date(dateStr + 'T00:00:00Z'),
    text: text.slice(0, 300),
    clientId,
  })
  return respondMutation(user.id, sinceId, { noteId })
}
