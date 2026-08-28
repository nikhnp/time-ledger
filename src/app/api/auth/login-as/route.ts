import { NextRequest } from 'next/server'
import { getSessionUser, jsonError, sessionCookieHeader } from '@/lib/server/auth'
import { findUserById, createSessionRow } from '@/lib/neon-sql'
import { randomBytes } from 'node:crypto'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/login-as
 * Body: { targetId: string }
 *
 * Admin-only: creates an impersonation session for the target user.
 * Sets the session cookie with `impersonatedBy` set to the admin's user id.
 * Session expires in 4 hours (shorter than normal 30-day sessions).
 */
export async function POST(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')
  if (me.role !== 'admin') return jsonError(403, 'admins only')

  let body: { targetId?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }
  if (!body.targetId) return jsonError(400, 'targetId is required')

  const target = await findUserById(body.targetId)
  if (!target) return jsonError(404, 'user not found')
  if (target.id === me.id) return jsonError(400, 'cannot login as yourself')

  const sessionToken = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000) // 4 hours
  await createSessionRow({
    token: sessionToken,
    userId: target.id,
    expiresAt,
    impersonatedBy: me.id,
  })

  return new Response(JSON.stringify({
    ok: true,
    user: { id: target.id, name: target.name, role: target.role },
    impersonatedBy: me.id,
    sessionExpiresAt: expiresAt.toISOString(),
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookieHeader(sessionToken, expiresAt),
    },
  })
}
