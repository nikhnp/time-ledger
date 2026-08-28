import { NextRequest } from 'next/server'
import { countUsers } from '@/lib/neon-sql'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/db-test
 *
 * Diagnostic route — runs database tests:
 *   1. Data-layer helper (countUsers via Prisma Client)
 *   2. Prisma raw query (proves raw SQL access works)
 *
 * Each test returns { ok: boolean, result?, error? }.
 * Safe to leave deployed: returns no sensitive data.
 */
export async function GET(_req: NextRequest) {
  const test1: { ok: boolean; result?: unknown; error?: string } = { ok: false }
  try {
    const count = await countUsers()
    test1.ok = true
    test1.result = count
  } catch (err) {
    test1.error = err instanceof Error ? err.message : String(err)
  }

  const test2: { ok: boolean; result?: unknown; error?: string } = { ok: false }
  try {
    const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM "User"`
    test2.ok = true
    test2.result = Number(rows[0]?.count ?? 0)
  } catch (err) {
    test2.error = err instanceof Error ? err.message : String(err)
  }

  const ok = test1.ok
  return Response.json({
    ok,
    tests: { dataLayer: test1, rawQuery: test2 },
    interpretation: {
      dataLayerOk: test1.ok,
      recommendation: ok
        ? 'database reachable through the Prisma data layer'
        : 'check DATABASE_URL and that `bun run db:push` has created the schema',
    },
  })
}
