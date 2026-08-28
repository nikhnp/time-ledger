import { NextRequest } from 'next/server'
import { getSessionUser, jsonError, clearSessionCookieHeader } from '@/lib/server/auth'
import { deleteUserAndAllData, logAdminAction, countAdmins } from '@/lib/neon-sql'
import { generateId } from '@/lib/server/cuid'

export const dynamic = 'force-dynamic'

/**
 * POST /api/account/delete
 *
 * v11: lets a signed-in user remove their own account and all of its data.
 * Guards:
 *   - the last admin cannot delete themselves (another admin must exist,
 *     or promote someone first / delete from the admin panel)
 *   - the session cookie is cleared on success
 */
export async function POST(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  try {
    if (me.role === 'admin') {
      const admins = await countAdmins()
      if (admins <= 1) {
        return jsonError(400, 'You are the only admin — promote another member first, or ask another admin to remove this account.')
      }
    }

    /* audit trail (actor = target = the user) */
    await logAdminAction({
      id: generateId(),
      actorId: me.id,
      targetId: me.id,
      action: 'self_delete',
      details: { name: me.name },
    }).catch(() => { /* audit is best-effort */ })

    await deleteUserAndAllData(me.id)

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': clearSessionCookieHeader(),
      },
    })
  } catch (err) {
    console.error('account/delete error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    return jsonError(500, `Could not remove account: ${raw}`)
  }
}
