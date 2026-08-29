import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { assembleLedgerRaw, changesSince, maxChangeId, buildPatchFromChanges, pruneChangeLog } from '@/lib/neon-sql'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ledger
 * v9: uses assembleLedgerRaw (raw SQL).
 *
 * P2-1 delta mode: `?since=<cursor>` returns only what changed for this user
 * since that ChangeLog id — `{ cursor, patch, deleted }`. Two cases fall back
 * to the full ledger (`{ ledger, cursor }`):
 *  - the cursor is below the user's syncWatermark (feed rows they never saw
 *    were pruned — e.g. offline for a long time, or a backup restore);
 *  - the cursor is unknown/bogus (fresh device, > current max id).
 * A missing/absent `since` (boot) always returns the full ledger + cursor.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'not logged in')
  try {
    const sinceParam = req.nextUrl.searchParams.get('since')
    if (sinceParam === null) {
      const [ledger, cursor] = await Promise.all([assembleLedgerRaw(user.id), maxChangeId()])
      return Response.json({ ledger, cursor })
    }

    const since = Number(sinceParam)
    if (!Number.isInteger(since) || since < 0) {
      // bogus cursor — treat as a fresh device
      const [ledger, cursor] = await Promise.all([assembleLedgerRaw(user.id), maxChangeId()])
      return Response.json({ ledger, cursor })
    }

    const [me, rows, cursor] = await Promise.all([
      db.user.findUnique({ where: { id: user.id }, select: { syncWatermark: true } }),
      changesSince(user.id, since),
      maxChangeId(),
    ])
    const watermark = me?.syncWatermark ?? 0
    if (since < watermark || since > cursor) {
      // gap: unseen changes were pruned (or the cursor is from the future —
      // e.g. this device was restored from elsewhere) — full sync, once.
      const ledger = await assembleLedgerRaw(user.id)
      return Response.json({ ledger, cursor })
    }

    const { patch, deleted } = await buildPatchFromChanges(user.id, rows)
    await pruneChangeLog(user.id)
    return Response.json({ cursor, patch, deleted })
  } catch (err) {
    console.error('ledger error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    const safe = raw.replace(/postgresql:\/\/[^\s]*/g, 'postgresql://***').replace(/postgres:\/\/[^\s]*/g, 'postgres://***').replace(/password[:=]\s*\S+/gi, 'password=***')
    return jsonError(500, `Failed to load ledger: ${safe}`)
  }
}
