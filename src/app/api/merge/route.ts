import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { applyMergeDelta } from '@/lib/server/ledger'
import { maxChangeId, respondMutation } from '@/lib/neon-sql'
import { todayIn } from '@/lib/dates'
import type { MergeDelta, MergeResult } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/merge
 * v9: getSessionUser + applyMergeDelta use raw SQL.
 * P1-5: dateless deltas land on the USER's local day (tz from their profile).
 * P2-1: responds with a patch of the re-folded affected days + new notes
 * instead of re-shipping the whole ledger (capture is the heaviest write).
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')

  let body: unknown
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const deltas: MergeDelta[] = Array.isArray(body) ? body : [body as MergeDelta]
  const results: MergeResult[] = []
  try {
    const sinceId = await maxChangeId()
    for (const d of deltas) {
      if (!d || typeof d !== 'object') return jsonError(400, 'delta must be an object')
      results.push(await applyMergeDelta(user.id, d, { today: todayIn(user.tz) }))
    }
    return respondMutation(user.id, sinceId, { results })
  } catch (err) {
    console.error('merge error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    const safe = raw.replace(/postgresql:\/\/[^\s]*/g, 'postgresql://***').replace(/postgres:\/\/[^\s]*/g, 'postgres://***').replace(/password[:=]\s*\S+/gi, 'password=***')
    return jsonError(500, `Merge failed: ${safe}`)
  }
}
