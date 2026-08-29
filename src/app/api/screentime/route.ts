import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import {
  findScreenEntriesByRange,
  upsertScreenEntries,
  deleteScreenEntry,
} from '@/lib/neon-sql'
import { SCREEN_CATEGORIES, type ScreenEntryT } from '@/lib/types'

export const dynamic = 'force-dynamic'

const VALID_TOOLS_DATES = /^\d{4}-\d{2}-\d{2}$/

function s2d(s: string): Date { return new Date(s + 'T00:00:00Z') }
function d2s(d: Date): string { return d.toISOString().slice(0, 10) }

/** GET /api/screentime?from=YYYY-MM-DD&to=YYYY-MM-DD — entries in range (default: last 7 days). */
export async function GET(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  const sp = req.nextUrl.searchParams
  const today = new Date()
  const todayD = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const to = sp.get('to') && VALID_TOOLS_DATES.test(sp.get('to')!) ? s2d(sp.get('to')!) : todayD
  const from = sp.get('from') && VALID_TOOLS_DATES.test(sp.get('from')!) ? s2d(sp.get('from')!) : new Date(to.getTime() - 6 * 86400000)

  const rows = await findScreenEntriesByRange(me.id, from, to)
  const entries: ScreenEntryT[] = rows.map((r) => ({
    id: r.id,
    date: d2s(r.date),
    appName: r.appName,
    category: r.category,
    minutes: r.minutes,
  }))
  return Response.json({ entries })
}

/** POST /api/screentime — body: { date, items: [{ appName, category?, minutes }] }.
 * Re-logging the same app on the same day replaces its minutes. */
export async function POST(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  let body: { date?: string; items?: Array<{ appName?: string; category?: string; minutes?: number }> }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const date = String(body.date ?? '')
  if (!VALID_TOOLS_DATES.test(date)) return jsonError(400, 'date must be YYYY-MM-DD')
  if (!Array.isArray(body.items) || body.items.length === 0) return jsonError(400, 'items[] is required')

  const items = body.items
    .filter((i) => i && typeof i.appName === 'string' && i.appName.trim())
    .slice(0, 40)
    .map((i) => ({
      appName: String(i.appName).trim().slice(0, 60),
      category: SCREEN_CATEGORIES.includes(i.category as never) ? String(i.category) : 'other',
      minutes: Math.max(0, Math.min(1440, Math.round(Number(i.minutes) || 0))),
    }))
  if (items.length === 0) return jsonError(400, 'no usable items')

  await upsertScreenEntries(me.id, s2d(date), items)

  /* return the fresh day (and week around it, matching the GET shape) */
  const day = s2d(date)
  const from = new Date(day.getTime() - 6 * 86400000)
  const rows = await findScreenEntriesByRange(me.id, from, day)
  const entries: ScreenEntryT[] = rows.map((r) => ({
    id: r.id,
    date: d2s(r.date),
    appName: r.appName,
    category: r.category,
    minutes: r.minutes,
  }))
  return Response.json({ entries })
}

/** DELETE /api/screentime?id=... — remove one entry (must belong to the caller). */
export async function DELETE(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return jsonError(400, 'id is required')

  await deleteScreenEntry(me.id, id)
  return Response.json({ ok: true })
}
