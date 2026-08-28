import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { getHabitConsistencyData } from '@/lib/neon-sql'

export const dynamic = 'force-dynamic'

/**
 * GET /api/habits/consistency?habitId=...&weeks=18
 *
 * Returns 7 × weeks cells (oldest first, today last) showing habit completion.
 * Used by the ConsistencyHeatmap component in TodayView.
 */
export async function GET(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  const url = new URL(req.url)
  const habitId = url.searchParams.get('habitId')
  if (!habitId) return jsonError(400, 'habitId is required')
  const weeks = Math.min(Math.max(Number(url.searchParams.get('weeks') ?? '18'), 4), 52)

  try {
    const cells = await getHabitConsistencyData(me.id, habitId, weeks)
    return Response.json({ cells, weeks, habitId })
  } catch (err) {
    console.error('consistency error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    return jsonError(500, `Consistency failed: ${raw}`)
  }
}
