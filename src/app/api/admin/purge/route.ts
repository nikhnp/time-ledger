import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/purge — P3-4: the "leave it running" sweep.
 *
 * Called by a daily scheduled job (Netlify scheduled function or cron) with
 * header `x-cron-secret: $CRON_SECRET` (compare against a long random
 * string). NOT a user route — no session, no admin role check, ONLY the
 * secret: it runs where no cookie exists.
 *
 * Deletes:
 *  - expired sessions (they already die on read — this keeps the table small)
 *  - consumed/ended impersonation sessions past expiry
 *  - stale password-reset tokens (expired > 7 days ago)
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return jsonError(503, 'purge disabled — CRON_SECRET not configured')
  const provided = req.headers.get('x-cron-secret') ?? ''
  if (provided !== secret) return jsonError(403, 'bad cron secret')

  const now = new Date()
  const staleResetBefore = new Date(now.getTime() - 7 * 86400000)

  const [sessions, impersonation, users] = await Promise.all([
    db.session.deleteMany({ where: { expiresAt: { lte: now } } }),
    db.session.deleteMany({ where: { impersonatedBy: { not: null }, expiresAt: { lte: now } } }),
    db.user.updateMany({
      where: { passwordResetExpires: { lt: staleResetBefore } },
      data: { passwordResetToken: null, passwordResetExpires: null },
    }),
  ])

  return Response.json({
    ok: true,
    purged: {
      expiredSessions: sessions.count,
      expiredImpersonationSessions: impersonation.count,
      staleResetTokens: users.count,
    },
    at: now.toISOString(),
  })
}
