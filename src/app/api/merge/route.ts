import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { applyMergeDelta, assembleLedger } from '@/lib/server/ledger'
import type { MergeDelta, MergeResult } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/merge
 * v9: getSessionUser + applyMergeDelta + assembleLedger all use raw SQL.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')

  let body: unknown
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const deltas: MergeDelta[] = Array.isArray(body) ? body : [body as MergeDelta]
  const results: MergeResult[] = []
  try {
    for (const d of deltas) {
      if (!d || typeof d !== 'object') return jsonError(400, 'delta must be an object')
      results.push(await applyMergeDelta(user.id, d))
    }
    const ledger = await assembleLedger(user.id)
    return Response.json({ ledger, results })
  } catch (err) {
    console.error('merge error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    const safe = raw.replace(/postgresql:\/\/[^\s]*/g, 'postgresql://***').replace(/postgres:\/\/[^\s]*/g, 'postgres://***').replace(/password[:=]\s*\S+/gi, 'password=***')
    return jsonError(500, `Merge failed: ${safe}`)
  }
}
