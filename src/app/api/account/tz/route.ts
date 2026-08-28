import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { updateUser } from '@/lib/neon-sql'

export const dynamic = 'force-dynamic'

/**
 * POST /api/account/tz
 * Body: { tz: "Asia/Kathmandu" }
 *
 * P1-5: the client reports its IANA timezone once at boot; the server stores
 * it and uses it to resolve the user's "today" for dateless captures
 * (merge fallback, habit toggles, notes) and reflections.
 */
export async function POST(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  let body: { tz?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const tz = String(body.tz ?? '').trim().slice(0, 64)
  if (!tz) return jsonError(400, 'tz is required')
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }) // throws on unknown zones
  } catch {
    return jsonError(400, 'unknown timezone')
  }

  await updateUser({ id: me.id, tz })
  return Response.json({ ok: true, tz })
}
