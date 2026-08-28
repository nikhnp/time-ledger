import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { createNote, assembleLedgerRaw } from '@/lib/neon-sql'
import { validDateStr } from '@/lib/server/ledger'
import { todayIn } from '@/lib/dates'
import { generateId } from '@/lib/server/cuid'

export const dynamic = 'force-dynamic'

/**
 * POST /api/notes
 * v9: uses raw SQL.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  let body: { text?: string; date?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }
  const text = String(body.text ?? '').trim()
  if (!text) return jsonError(400, 'Write something first.')
  // P1-5: dateless notes land on the user's local day
  const dateStr = validDateStr(body.date) ? body.date : todayIn(user.tz)
  const noteId = generateId()
  await createNote({
    id: noteId,
    userId: user.id,
    date: new Date(dateStr + 'T00:00:00Z'),
    text: text.slice(0, 300),
  })
  return Response.json({ ledger: await assembleLedgerRaw(user.id), noteId })
}
