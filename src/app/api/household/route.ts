import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { findAllUsersOrderedByCreatedAt, householdAggregate } from '@/lib/neon-sql'
import { d2s } from '@/lib/server/ledger'
import type { HouseholdRow } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/household
 * v9: raw SQL. P2-5: the per-user loop (N window fetches + N last-activity
 * fetches) became ONE window query + ONE groupBy — two queries total,
 * independent of household size. Payload shape identical.
 */
export async function GET(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  try {
    /* Monday-aligned current week, UTC */
    const now = new Date()
    const day = now.getUTCDay()
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((day + 6) % 7)))
    const sunday = new Date(monday.getTime() + 6 * 86400000)

    const [users, agg] = await Promise.all([
      findAllUsersOrderedByCreatedAt(),
      householdAggregate(monday, sunday),
    ])
    const byUser = new Map(agg.map((a) => [a.userId, a]))
    const rows: HouseholdRow[] = users.map((u) => {
      const a = byUser.get(u.id)
      return {
        name: u.name,
        role: u.role === 'admin' ? 'admin' : 'member',
        hoursThisWeek: a?.hoursThisWeek ?? 0,
        daysThisWeek: a?.daysThisWeek ?? 0,
        updated: a?.lastDay ? d2s(a.lastDay) : null,
      }
    })
    return Response.json({ household: rows })
  } catch (err) {
    console.error('household error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    const safe = raw.replace(/postgresql:\/\/[^\s]*/g, 'postgresql://***').replace(/postgres:\/\/[^\s]*/g, 'postgres://***').replace(/password[:=]\s*\S+/gi, 'password=***')
    return jsonError(500, `Household failed: ${safe}`)
  }
}
