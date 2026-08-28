import { NextRequest } from 'next/server'
import { findUserByName, createSessionRow, assembleLedgerRaw } from '@/lib/neon-sql'
import { sessionCookieHeader, verifyPassword, jsonError } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/login
 * v9: uses raw Neon SQL. Returns REAL ledger.
 */
export async function POST(req: NextRequest) {
  let body: { name?: string; password?: string }
  try { body = await req.json() } catch { return jsonError(400, 'Invalid request body.') }

  const name = String(body.name ?? '').trim()
  const pw = String(body.password ?? '')

  if (!name) return jsonError(400, 'Whose book is this? Enter a username.')
  if (name.length < 2) return jsonError(400, 'Username must be at least 2 characters.')
  if (!pw) return jsonError(400, 'Need a password.')
  if (pw.length < 6) return jsonError(400, 'Password must be at least 6 characters.')

  try {
    const user = await findUserByName(name)
    if (!user) {
      return jsonError(404, `No account named "${name}". Sign up to create one.`)
    }
    if (user.passwordHash && !verifyPassword(pw, user.passwordHash)) {
      return jsonError(401, "That password doesn't open this book.")
    }

    const { randomBytes } = await import('node:crypto')
    const token = randomBytes(32).toString('hex')
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
