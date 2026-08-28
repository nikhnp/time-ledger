import { NextRequest } from 'next/server'
import { getSessionUser, hashPassword, jsonError } from '@/lib/server/auth'
import { updateUser } from '@/lib/neon-sql'

export const dynamic = 'force-dynamic'

/**
 * POST /api/account/password
 * v9: uses raw SQL.
 */
export async function POST(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')
  let body: { password?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }
  const pw = String(body.password ?? '')
  if (!pw || pw.length < 4) return jsonError(400, 'Use at least 4 characters.')
  await updateUser({ id: me.id, passwordHash: hashPassword(pw), forceLogoutAt: null })
  return Response.json({ ok: true })
}
