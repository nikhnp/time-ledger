import { NextRequest } from 'next/server'
import {
  getSessionUser,
  hashPassword,
  verifyPassword,
  burnPasswordCheck,
  jsonError,
} from '@/lib/server/auth'
import { updateUser, deleteSessionsByUser } from '@/lib/neon-sql'
import { limit, POLICY } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/account/password
 * Body: { currentPassword, password }
 *
 * P1-1d hardening vs v10.3 (which accepted { password } with no checks):
 *  - requires the CURRENT password (a hijacked tab can't silently rotate it)
 *  - minimum 8 characters (was 4)
 *  - rate limited per user (5 / hour)
 *  - revokes every OTHER session after a change; the current session stays
 *    logged in.
 */
export async function POST(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  if (!(await limit(`pwchange:${me.id}`, POLICY.passwordChange.max, POLICY.passwordChange.windowMs))) {
    return jsonError(429, 'Too many attempts. Try again later.')
  }

  let body: { currentPassword?: string; password?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const currentPw = String(body.currentPassword ?? '')
  const pw = String(body.password ?? '')
  if (pw.length < 8) return jsonError(400, 'New password must be at least 8 characters.')

  // Verify the current password. Users created before the NOT NULL migration
  // backfill have a usable hash; the !currentPw case burns the same CPU so
  // this route can't be probed for "does this account have a password".
  const { findUserById } = await import('@/lib/neon-sql')
  const user = await findUserById(me.id)
  if (!user) return jsonError(401, 'not logged in')
  if (!user.passwordHash || !currentPw) {
    burnPasswordCheck()
    return jsonError(403, 'Current password is required.')
  }
  if (!verifyPassword(currentPw, user.passwordHash)) {
    return jsonError(403, "That current password doesn't match.")
  }

  await updateUser({ id: me.id, passwordHash: hashPassword(pw), forceLogoutAt: null })

  // Revoke all other sessions (by token hash, keeping this device logged in).
  const { readSessionToken, hashToken } = await import('@/lib/server/auth')
  const token = readSessionToken(req)
  if (token) {
    await deleteSessionsByUser(me.id, hashToken(token))
  }

  return Response.json({ ok: true })
}
