import { NextRequest } from 'next/server'
import { jsonError, hashPassword, sessionCookieHeader } from '@/lib/server/auth'
import {
  findUserByName,
  createUser,
  countUsers,
  createSessionRow,
  updateUser,
  assembleLedgerRaw,
} from '@/lib/neon-sql'
import { generateId } from '@/lib/server/cuid'
import { randomBytes } from 'node:crypto'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/reset-password
 *
 * Two flows:
 *
 * 1. GET /?reset=TOKEN — user lands here from an admin-shared reset link.
 *    Client sends { action: 'verify', token: '...' } → returns { valid: true, name: 'username' }
 *
 * 2. User submits new password:
 *    { action: 'reset', token: '...', password: '...' } → resets password, logs in, returns user + ledger
 *
 * Tokens are single-use — once consumed, the passwordResetToken field is cleared.
 */
export async function POST(req: NextRequest) {
  let body: { action?: string; token?: string; password?: string; name?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  if (body.action === 'verify') {
    if (!body.token) return jsonError(400, 'token is required')
    // Find user by reset token — since we don't have a dedicated helper, do it inline
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
    if (!pw || pw.length < 6) return jsonError(400, 'Password must be at least 6 characters.')

    const { findUserByResetToken } = await import('@/lib/neon-sql')
    const user = await findUserByResetToken(body.token)
    if (!user) return jsonError(404, 'invalid or expired token')
    if (user.passwordResetExpires && user.passwordResetExpires < new Date()) {
      return jsonError(410, 'token has expired')
    }

    // Reset password and clear token
    await updateUser({
      id: user.id,
      passwordHash: hashPassword(pw),
      passwordResetToken: null,
      passwordResetExpires: null,
      forceLogoutAt: null,
      isActive: true,
    })

    // Create a fresh session
    const sessionToken = randomBytes(32).toString('hex')
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
