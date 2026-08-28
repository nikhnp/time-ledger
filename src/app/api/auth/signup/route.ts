import { NextRequest } from 'next/server'
import { createUser, findUserByName, countUsers, createSessionRow, assembleLedgerRaw, createGoal, createHabit } from '@/lib/neon-sql'
import { hashPassword, sessionCookieHeader, jsonError } from '@/lib/server/auth'
import { generateId } from '@/lib/server/cuid'

export const dynamic = 'force-dynamic'

/** Starter catalog for a fresh book — three goals and two habits, the same
 * shape the original demo users shipped with. Users can rename or ignore
 * them; the goal ids match the classic category palette (deep-work etc.). */
async function seedStarterCatalog(userId: string) {
  await createGoal({ userId, id: 'deep-work', name: 'Deep work', unit: 'hours', target: 60, weeklyTargetHours: 12, sortOrder: 0 })
  await createGoal({ userId, id: 'learning', name: 'Learning', unit: 'hours', target: 30, weeklyTargetHours: 5, sortOrder: 1 })
  await createGoal({ userId, id: 'health', name: 'Health', unit: 'hours', target: 30, weeklyTargetHours: 4, sortOrder: 2 })
  await createHabit({ userId, id: 'meditate', name: 'Meditate', targetPerWeek: 7, sortOrder: 0 })
  await createHabit({ userId, id: 'read-bed', name: 'Read before bed', targetPerWeek: 5, sortOrder: 1 })
}

/**
 * POST /api/auth/signup
 * Body: { name: string, password: string }
 *
 * v9: uses raw Neon SQL. Returns REAL ledger (now that assembleLedger works).
 */
export async function POST(req: NextRequest) {
  let body: { name?: string; password?: string }
  try { body = await req.json() } catch { return jsonError(400, 'Invalid request body.') }

  const name = String(body.name ?? '').trim()
  const pw = String(body.password ?? '')

  if (!name) return jsonError(400, 'Pick a username.')
  if (name.length < 2) return jsonError(400, 'Username must be at least 2 characters.')
  if (name.length > 40) return jsonError(400, 'Username must be 40 characters or fewer.')
  if (!/^[a-zA-Z0-9 _.-]+$/.test(name))
    return jsonError(400, 'Username may only contain letters, numbers, spaces, ., _, or -.')
  if (!pw) return jsonError(400, 'Pick a password.')
  if (pw.length < 6) return jsonError(400, 'Password must be at least 6 characters.')

  try {
    const existing = await findUserByName(name)
    if (existing) {
      return jsonError(409, `An account named "${name}" already exists. Sign in instead.`)
    }

    const userCount = await countUsers()
    const role = userCount === 0 ? 'admin' : 'member'

    const passwordHash = hashPassword(pw)
    const user = await createUser({
      id: generateId(),
      name,
      role,
      passwordHash,
    })

    // Create session via raw SQL
    const { randomBytes } = await import('node:crypto')
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 30 * 86400000)
    await createSessionRow({ token, userId: user.id, expiresAt })

    // v11: give the fresh book a starter catalog (goals + habits)
    await seedStarterCatalog(user.id).catch((e) => console.warn('starter catalog failed:', e))

    // Return REAL ledger (v9 — assembleLedger now works)
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
    console.error('signup error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    const safe = raw.replace(/postgresql:\/\/[^\s]*/g, 'postgresql://***').replace(/postgres:\/\/[^\s]*/g, 'postgres://***').replace(/password[:=]\s*\S+/gi, 'password=***')
    return jsonError(500, `Signup failed: ${safe}`)
  }
}
