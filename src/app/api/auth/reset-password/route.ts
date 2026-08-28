import { NextRequest } from 'next/server'
import { jsonError, hashPassword, sessionCookieHeader, generateSessionToken } from '@/lib/server/auth'
import {
  createSessionRow,
  updateUser,
  assembleLedgerRaw,
} from '@/lib/neon-sql'
import { limit, clientIp, POLICY } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/reset-password
 *
 * Two flows:
 *
 * 1. { action: 'verify', token } → { valid: true, name } — from an
 *    admin-shared reset link (admin/users/[id] action "reset_link").
 * 2. { action: 'reset', token, password } → resets the password, logs in.
 *
 * Tokens are single-use, 24h, 32-byte hex (unchanged from v10.3 — that flow
 * audited solid). P1-1 changes: password minimum 8, per-IP rate limit, and
 * a reset no longer re-activates a deactivated account (admins reactivate
 * explicitly from the admin panel).
 */
export async function POST(req: NextRequest) {
  let body: { action?: string; token?: string; password?: string; name?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  if (!(await limit(`resetpw:${clientIp(req)}`, POLICY.resetPassword.max, POLICY.resetPassword.windowMs))) {
    return jsonError(429, 'Too many attempts. Try again later.')
  }

  if (body.action === 'verify') {
    if (!body.token) return jsonError(400, 'token is required')
    const { findUserByResetToken } = await import('@/lib/neon-sql')
    const user = await findUserByResetToken(body.token)
    if (!user) return jsonError(404, 'invalid or expired token')
    if (user.passwordResetExpires && user.passwordResetExpires < new Date()) {
      return jsonError(410, 'token has expired')
    }
    return Response.json({ valid: true, name: user.name })
  }

  if (body.action === 'reset') {
    if (!body.token) return jsonError(400, 'token is required')
    const pw = String(body.password ?? '')
    if (pw.length < 8) return jsonError(400, 'Password must be at least 8 characters.')

    const { findUserByResetToken } = await import('@/lib/neon-sql')
    const user = await findUserByResetToken(body.token)
    if (!user) return jsonError(404, 'invalid or expired token')
    if (user.passwordResetExpires && user.passwordResetExpires < new Date()) {
      return jsonError(410, 'token has expired')
    }
    // P1-1a: a reset must never be the path around deactivation.
    if (!user.isActive) {
      return jsonError(403, 'This account is deactivated. Ask an admin to reactivate it.')
    }

    // Reset password and clear token
    await updateUser({
      id: user.id,
      passwordHash: hashPassword(pw),
      passwordResetToken: null,
      passwordResetExpires: null,
      forceLogoutAt: null,
    })

    // Create a fresh session
    const sessionToken = generateSessionToken()
    const expiresAt = new Date(Date.now() + 30 * 86400000)
    await createSessionRow({ token: sessionToken, userId: user.id, expiresAt })

    const ledger = await assembleLedgerRaw(user.id)
    return new Response(JSON.stringify({
      user: { id: user.id, name: user.name, role: user.role },
      ledger,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': sessionCookieHeader(sessionToken, expiresAt),
      },
    })
  }

  return jsonError(400, 'action must be "verify" or "reset"')
}
