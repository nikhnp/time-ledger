import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import {
  findAllUsersOrderedByCreatedAt,
  countAdmins,
  countUsers,
  findLastSessionForUser,
  findAdminActions,
} from '@/lib/neon-sql'
import type { AdminUserRow, AdminActionLogT } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** GET /api/admin/users — list all users with admin metadata (admin only). */
export async function GET(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')
  if (me.role !== 'admin') return jsonError(403, 'admins only')

  const users = await findAllUsersOrderedByCreatedAt()
  const adminCount = await countAdmins()
  const userCount = await countUsers()

  const out: AdminUserRow[] = []
  for (const u of users) {
    const lastSession = await findLastSessionForUser(u.id)
    out.push({
      id: u.id,
      name: u.name,
      role: u.role === 'admin' ? 'admin' : 'member',
      isActive: u.isActive,
      createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : String(u.createdAt),
      lastActive: lastSession?.createdAt instanceof Date ? lastSession.createdAt.toISOString() : null,
      forceLogoutAt: u.forceLogoutAt instanceof Date ? u.forceLogoutAt.toISOString() : null,
    })
  }

  const recentActions: AdminActionLogT[] = (await findAdminActions(20)).map((a) => ({
    ...a,
    createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
  }))

  return Response.json({
    users: out,
    adminCount,
    userCount,
    recentActions,
  })
}
