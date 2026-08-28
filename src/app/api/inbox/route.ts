import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { createInboxItem, assembleLedgerRaw } from '@/lib/neon-sql'
import { generateId } from '@/lib/server/cuid'

export const dynamic = 'force-dynamic'

/**
 * POST /api/inbox
 * v9: uses raw SQL.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  let body: { text?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }
  const text = String(body.text ?? '').trim()
  if (!text) return jsonError(400, 'Capture something first.')
  await createInboxItem({ id: generateId(), userId: user.id, text: text.slice(0, 300) })
  return Response.json({ ledger: await assembleLedgerRaw(user.id) })
}
