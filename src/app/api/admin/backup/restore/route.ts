import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import {
  findUserBackupById,
  restoreUserPayload,
  logAdminAction,
} from '@/lib/neon-sql'
import { generateId } from '@/lib/server/cuid'
import type { UserBackupPayload } from '@/lib/neon-sql'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/backup/restore — restore a user's data from a backup.
 *
 * Body: { backupId: string }
 *
 * The user must already exist (or be re-created by the restore process).
 * All existing data for that user is wiped and replaced with the backup.
 *
 * Note: this does NOT restore LLM settings or sessions — only the user's
 * ledger data (goals, tasks, habits, days, activities, notes, inbox).
 */
export async function POST(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')
  if (me.role !== 'admin') return jsonError(403, 'admins only')

  let body: { backupId?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }
  if (!body.backupId) return jsonError(400, 'backupId is required')

  const backup = await findUserBackupById(body.backupId)
  if (!backup) return jsonError(404, 'backup not found')

  // Restore — the payload includes the user row, so it'll re-create the user if deleted
  await restoreUserPayload(backup.userId, backup.payload as UserBackupPayload)

  await logAdminAction({
    id: generateId(),
    actorId: me.id,
    targetId: backup.userId,
    action: 'restore',
    details: { backupId: backup.id },
  })

  return Response.json({ ok: true, restoredUserId: backup.userId })
}
