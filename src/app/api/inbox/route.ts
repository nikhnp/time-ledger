import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { createInboxItem, maxChangeId, respondMutation } from '@/lib/neon-sql'
import { generateId } from '@/lib/server/cuid'

export const dynamic = 'force-dynamic'

/**
 * POST /api/inbox
 * P2-1: responds with a per-entity patch + cursor instead of the full ledger.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  let body: { text?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }
  const text = String(body.text ?? '').trim()
  if (!text) return jsonError(400, 'Capture something first.')
  const sinceId = await maxChangeId()
  await createInboxItem({ id: generateId(), userId: user.id, text: text.slice(0, 300) })
  return respondMutation(user.id, sinceId)
}
