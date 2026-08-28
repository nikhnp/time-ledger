import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/env-check
 *
 * Diagnostic route — returns a sanitized snapshot of the DATABASE_URL state
 * as seen by the serverless function at runtime. Use this to confirm whether
 * Netlify actually injected the env var into the function runtime, and
 * whether the URL pattern matches what `db.ts` expects.
 *
 * Safe to leave deployed: never returns the full URL, only structural info.
 * Remove or guard behind admin auth before going to production.
 */
export async function GET(_req: NextRequest) {
  const url = process.env.DATABASE_URL ?? ''
  const hasUrl = typeof process.env.DATABASE_URL === 'string' && url.length > 0

  return Response.json({
    // Whether the env var is visible at runtime in the function
    hasDatabaseUrl: hasUrl,
    // Length only — never the actual value
    length: url.length,
    // First 12 chars (enough to see the `postgresql://` prefix and start of user)
    prefix: url ? url.slice(0, 12) : '',
    // Last 12 chars (enough to see `?sslmode=require`)
    suffix: url ? url.slice(-12) : '',
    // Whether the URL matches Neon patterns (what db.ts checks)
    containsNeonTech: url.includes('neon.tech'),
    containsNeonBuild: url.includes('neon.build'),
    containsNeonDot: url.includes('neon.'),
    containsSslMode: url.includes('sslmode='),
    // Other env vars that might be relevant
    nodeEnv: process.env.NODE_ENV ?? null,
    useNeonAdapter: process.env.USE_NEON_ADAPTER ?? null,
    // All env var keys that look DB-related (names only, never values)
    dbLikeEnvKeys: Object.keys(process.env).filter((k) =>
      /db|data|postgres|neon|prisma|connection/i.test(k),
    ),
    // Netlify-specific markers (proves we're in a Netlify function)
    isNetlify: !!process.env.NETLIFY,
    netlifyContext: process.env.CONTEXT ?? null,
    deployId: process.env.DEPLOY_ID ?? null,
  })
}
