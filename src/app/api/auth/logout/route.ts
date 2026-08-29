import { NextRequest } from 'next/server'
import { clearSessionCookieHeader, destroySession } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/logout
 * v9: destroySession uses raw SQL internally.
 */
export async function POST(req: NextRequest) {
  await destroySession(req)
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookieHeader() },
  })
}
