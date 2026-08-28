import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { findAllUsersOrderedByCreatedAt, findActivitiesByUserAndDateRange, findLastActivityDateByUser } from '@/lib/neon-sql'
import { d2s } from '@/lib/server/ledger'
import type { HouseholdRow } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/household
 * v9: uses raw SQL.
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

    const users = await findAllUsersOrderedByCreatedAt()
    const rows: HouseholdRow[] = []
    for (const u of users) {
      const acts = await findActivitiesByUserAndDateRange(u.id, monday, sunday)
      const hours = acts.reduce((s, a) => s + a.hours, 0)
      const days = new Set(acts.filter((a) => a.hours > 0).map((a) => d2s(a.date))).size
      const lastDay = await findLastActivityDateByUser(u.id)
      rows.push({
        name: u.name,
        role: u.role === 'admin' ? 'admin' : 'member',
        hoursThisWeek: +hours.toFixed(1),
        daysThisWeek: days,
        updated: lastDay ? d2s(lastDay) : null,
      })
    }
    return Response.json({ household: rows })
  } catch (err) {
    console.error('household error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    const safe = raw.replace(/postgresql:\/\/[^\s]*/g, 'postgresql://***').replace(/postgres:\/\/[^\s]*/g, 'postgres://***').replace(/password[:=]\s*\S+/gi, 'password=***')
    return jsonError(500, `Household failed: ${safe}`)
  }
}
