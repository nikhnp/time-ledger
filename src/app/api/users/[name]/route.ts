import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import {
  findUserByName,
  countAdmins,
  updateUser,
  deleteSessionsByUser,
  assembleLedgerRaw,
} from '@/lib/neon-sql'
import { assembleLedger } from '@/lib/server/ledger'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/users/[name]
 * Admin-only: grant / revoke admin, kick.
 * (v10.3's 'resetpw' action was removed in P1-1a — it set passwordHash to
 * null, which made login accept ANY password for that user.)
 * v9: uses raw SQL.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')
  if (me.role !== 'admin') return jsonError(403, 'admins only')
  const { name } = await params

  let body: { action?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const user = await findUserByName(decodeURIComponent(name))
  if (!user) return jsonError(404, 'unknown user')

  const admins = await countAdmins()

  switch (body.action) {
    case 'grant':
      if (user.role === 'admin') return jsonError(400, 'already an admin')
      if (admins >= 2) return jsonError(400, 'Two admins max.')
      await updateUser({ id: user.id, role: 'admin' })
      break
    case 'revoke':
      if (user.role !== 'admin') return jsonError(400, 'not an admin')
      if (admins <= 1) return jsonError(400, 'At least one admin required.')
      await updateUser({ id: user.id, role: 'member' })
      break
    case 'kick':
      await updateUser({ id: user.id, forceLogoutAt: new Date() })
      await deleteSessionsByUser(user.id)
      break
    default:
      // P1-1a: 'resetpw' (set passwordHash = null) was REMOVED — a null hash
      // used to let ANY password log in. Password resets go through the
      // admin reset_link flow (admin/users/[id] → reset_link).
      return jsonError(400, 'unknown action (grant | revoke | kick)')
  }

  return Response.json({ ledger: await assembleLedger(me.id) })
}
