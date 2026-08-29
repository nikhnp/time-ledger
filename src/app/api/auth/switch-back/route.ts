import { NextRequest } from 'next/server'
import {
  getSessionUser,
  jsonError,
  sessionCookieHeader,
  readSessionToken,
} from '@/lib/server/auth'
import { deleteSession, findUserById, createSessionRow } from '@/lib/neon-sql'
import { generateSessionToken } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/switch-back
 *
 * Used by admins who used "Login as user" (impersonation) and want to
 * return to their own admin account without manually signing out and
 * signing back in.
 *
 * Flow:
 *   1. Read current session token from cookie (single shared reader — P1-1c)
 *   2. Look up session — should have `impersonatedBy` set to admin's user id
 *   3. Delete the impersonation session
 *   4. Create a fresh 30-day session for the admin (impersonatedBy = null)
 *   5. Return admin user info + set new session cookie
 *
 * If the current session isn't an impersonation session (impersonatedBy is
 * null), returns 400 — they're already on their own account.
 */
export async function POST(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')
  if (!me.impersonatedBy) return jsonError(400, 'not currently impersonating anyone')

  // Read session token from cookie so we can delete it
  const currentToken = readSessionToken(req)
  if (currentToken) {
    await deleteSession(currentToken).catch(() => {})
  }

  // Look up the admin user
  const admin = await findUserById(me.impersonatedBy)
  if (!admin) return jsonError(404, 'admin user no longer exists')
  if (!admin.isActive) return jsonError(403, 'admin account has been deactivated')

  // Create fresh session for the admin
  const sessionToken = generateSessionToken()
  const expiresAt = new Date(Date.now() + 30 * 86400000)
  await createSessionRow({
    token: sessionToken,
    userId: admin.id,
    expiresAt,
    impersonatedBy: null,
  })

  return new Response(JSON.stringify({
    ok: true,
    user: { id: admin.id, name: admin.name, role: admin.role },
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookieHeader(sessionToken, expiresAt),
    },
  })
}
