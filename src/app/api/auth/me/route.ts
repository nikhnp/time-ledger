import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { assembleLedgerRaw } from '@/lib/neon-sql'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/me
 * v9: uses raw Neon SQL via getSessionUser (which now uses neon-sql). Returns REAL ledger.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  try {
    const ledger = await assembleLedgerRaw(user.id)
    return Response.json({ user, ledger })
  } catch (err) {
    console.error('me error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    const safe = raw.replace(/postgresql:\/\/[^\s]*/g, 'postgresql://***').replace(/postgres:\/\/[^\s]*/g, 'postgres://***').replace(/password[:=]\s*\S+/gi, 'password=***')
    return jsonError(500, `me failed: ${safe}`)
  }
}
