import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import {
  findAllUsersOrderedByCreatedAt,
  findAllBackups,
  findUserBackupById,
  createUserBackup,
  exportUserPayload,
  logAdminAction,
} from '@/lib/neon-sql'
import { generateId } from '@/lib/server/cuid'
import type { UserBackupT } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/backup — list ALL backups (system-wide, admin only).
 *
 * GET /api/admin/backup?id=BACKUP_ID — download a single backup's full payload
 *   (returns the JSON payload directly, suitable for saving as a .json file)
 *
 * POST /api/admin/backup — create backups for ALL users (admin only).
 *   Body: { action: 'backup_all' }
 *   Returns: { backups: UserBackupT[] }
 */
export async function GET(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')
  if (me.role !== 'admin') return jsonError(403, 'admins only')

  // v10.1: single-backup download mode
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (id) {
    const backup = await findUserBackupById(id)
    if (!backup) return jsonError(404, 'backup not found')
    // Look up the username for a friendly filename
    const users = await findAllUsersOrderedByCreatedAt()
    const userMap = new Map(users.map((u) => [u.id, u.name]))
    const userName = userMap.get(backup.userId) ?? 'deleted-user'
    const filename = `backup-${userName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${backup.createdAt instanceof Date ? backup.createdAt.toISOString().slice(0, 10) : String(backup.createdAt).slice(0, 10)}.json`
    return new Response(JSON.stringify(backup.payload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  const backups = await findAllBackups()
  const users = await findAllUsersOrderedByCreatedAt()
  const userMap = new Map(users.map((u) => [u.id, u.name]))

  const out: UserBackupT[] = backups.map((b) => ({
    id: b.id,
    userId: b.userId,
    userName: userMap.get(b.userId) ?? '(deleted user)',
    createdBy: b.createdBy,
    createdByName: userMap.get(b.createdBy) ?? '(unknown admin)',
    createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : String(b.createdAt),
    sizeBytes: b.sizeBytes,
  }))
  return Response.json({ backups: out })
}

export async function POST(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')
  if (me.role !== 'admin') return jsonError(403, 'admins only')

  let body: { action?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }
  if (body.action !== 'backup_all') return jsonError(400, 'action must be "backup_all"')

  const users = await findAllUsersOrderedByCreatedAt()
  const created: UserBackupT[] = []

  for (const u of users) {
    const payload = await exportUserPayload(u.id)
    const result = await createUserBackup({
      id: generateId(),
      userId: u.id,
      createdBy: me.id,
      payload,
    })
    created.push({
      id: result.id,
      userId: u.id,
      userName: u.name,
      createdBy: me.id,
      createdByName: me.name,
      createdAt: result.createdAt instanceof Date ? result.createdAt.toISOString() : String(result.createdAt),
      sizeBytes: result.sizeBytes,
    })
  }

  await logAdminAction({
    id: generateId(),
    actorId: me.id,
    targetId: me.id, // self-target since this affects all users
    action: 'backup_all',
    details: { count: created.length },
  })

  return Response.json({ backups: created })
}
