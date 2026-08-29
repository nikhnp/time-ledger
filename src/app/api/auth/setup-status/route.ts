import { NextRequest } from 'next/server'
import { countUsers } from '@/lib/neon-sql'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/setup-status
 * v9: same as v8 — uses raw SQL via @neondatabase/serverless.
 */
export async function GET(_req: NextRequest) {
  const url = process.env.DATABASE_URL ?? ''
  if (!url) {
    return Response.json({ initialized: false, userCount: 0, error: 'db-not-configured' })
  }
  try {
    const userCount = await countUsers()
    return Response.json({ initialized: true, userCount, error: undefined })
  } catch (err) {
    console.error('setup-status error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    if (raw.includes('relation') || raw.includes('does not exist') || raw.includes('no such table') || raw.includes('42P01') || raw.includes('P2021')) {
      return Response.json({ initialized: false, userCount: 0, error: 'db-not-synced' })
    }
    const safe = raw.replace(/postgresql:\/\/[^\s]*/g, 'postgresql://***').replace(/postgres:\/\/[^\s]*/g, 'postgres://***').replace(/password[:=]\s*\S+/gi, 'password=***')
    return Response.json({ initialized: false, userCount: 0, error: 'db-error', message: safe })
  }
}
