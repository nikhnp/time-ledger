import { NextRequest } from 'next/server'
import {
  findUserByName,
  createSessionRow,
  assembleLedgerRaw,
} from '@/lib/neon-sql'
import {
  sessionCookieHeader,
  verifyPassword,
  burnPasswordCheck,
  generateSessionToken,
  jsonError,
} from '@/lib/server/auth'
import { limit, clientIp, POLICY } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/login
 * Body: { name, password }
 *
 * P1-1 hardening vs v10.3:
 *  - a NULL passwordHash can never authenticate (was: any password accepted);
 *    the column is NOT NULL since the P1 migration, this guard is the
 *    application-level backstop.
 *  - unknown username and wrong password return the SAME error + similar
 *    timing (dummy scrypt run), so accounts can't be enumerated.
 *  - rate limited per IP+username (5 / 15 min).
 */
export async function POST(req: NextRequest) {
  let body: { name?: string; password?: string }
  try { body = await req.json() } catch { return jsonError(400, 'Invalid request body.') }

  const name = String(body.name ?? '').trim()
  const pw = String(body.password ?? '')

  if (!name) return jsonError(400, 'Whose book is this? Enter a username.')
  if (name.length < 2) return jsonError(400, 'Username must be at least 2 characters.')
  if (!pw) return jsonError(400, 'Need a password.')
  // NOTE: no minimum-length check here — legacy accounts may have shorter
  // passwords. Length policy applies where passwords are SET
  // (signup / change / reset), never where they are verified.

  // Rate limit before ANY database work so brute force stops at the door.
  if (!(await limit(`login:${clientIp(req)}:${name.toLowerCase()}`, POLICY.login.max, POLICY.login.windowMs))) {
    return jsonError(429, 'Too many attempts. Take a breath and try again in a few minutes.')
  }

  try {
    const user = await findUserByName(name)
    if (!user) {
      burnPasswordCheck()
      return jsonError(401, "That password doesn't open this book.")
    }
    // Defense-in-depth: the DB column is NOT NULL now, but never trust that alone.
    if (!user.passwordHash) {
      return jsonError(403, 'This book has no password set. Ask an admin for a reset link.')
    }
    if (!verifyPassword(pw, user.passwordHash)) {
      return jsonError(401, "That password doesn't open this book.")
    }

    const token = generateSessionToken()
    const expiresAt = new Date(Date.now() + 30 * 86400000)
    await createSessionRow({ token, userId: user.id, expiresAt })

    // Return REAL ledger
    const ledger = await assembleLedgerRaw(user.id)

    return new Response(
      JSON.stringify({
        user: { id: user.id, name: user.name, role: user.role },
        ledger,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': sessionCookieHeader(token, expiresAt),
        },
      },
    )
  } catch (err) {
    console.error('login error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    const safe = raw.replace(/postgresql:\/\/[^\s]*/g, 'postgresql://***').replace(/postgres:\/\/[^\s]*/g, 'postgres://***').replace(/password[:=]\s*\S+/gi, 'password=***')
    return jsonError(500, `Login failed: ${safe}`)
  }
}
