import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { createImportantDate, assembleLedgerRaw } from '@/lib/neon-sql'
import { validDateStr } from '@/lib/server/ledger'
import { generateId } from '@/lib/server/cuid'

export const dynamic = 'force-dynamic'

/**
 * POST /api/important-dates
 * v9: uses raw SQL.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  let body: { label?: string; date?: string; type?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }
  const label = String(body.label ?? '').trim()
  if (!label) return jsonError(400, 'Give it a label.')
  if (!validDateStr(body.date)) return jsonError(400, 'Need a real date (YYYY-MM-DD).')
  const type = ['deadline', 'birthday', 'reminder', 'event'].includes(String(body.type)) ? String(body.type) : 'event'
  await createImportantDate({
    id: generateId(),
    userId: user.id,
    label: label.slice(0, 80),
    date: new Date(body.date + 'T00:00:00Z'),
    type,
  })
  return Response.json({ ledger: await assembleLedgerRaw(user.id) })
}
