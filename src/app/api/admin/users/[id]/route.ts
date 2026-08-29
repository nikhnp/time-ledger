import { NextRequest } from 'next/server'
import { getSessionUser, jsonError, sessionCookieHeader } from '@/lib/server/auth'
import {
  findUserById,
  findUserByName,
  updateUser,
  deleteSessionsByUser,
  deleteUserAndAllData,
  countAdmins,
  logAdminAction,
  createUserBackup,
  findUserBackups,
  exportUserPayload,
  findUserBackupById,
} from '@/lib/neon-sql'
import { generateId } from '@/lib/server/cuid'
import { randomBytes } from 'node:crypto'
import type { UserBackupT } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * /api/admin/users/[id]
 *
 * GET    — list the user's backups (with metadata only, not payload)
 * POST   — perform an admin action on the user. Body: { action: '...' }
 *          Actions: deactivate, activate, promote, demote, force_logout,
 *                   reset_link, login_as, delete, backup
 * DELETE — delete the user (alias for POST with action=delete)
 */

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')
  if (me.role !== 'admin') return jsonError(403, 'admins only')

  const { id } = await params
  const target = await resolveUser(id)
  if (!target) return jsonError(404, 'user not found')

  const backups = await findUserBackups(target.id)
  const out: UserBackupT[] = backups.map((b) => ({
    id: b.id,
    userId: b.userId,
    userName: target.name,
    createdBy: b.createdBy,
    createdByName: '', // populated by client if needed
    createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : String(b.createdAt),
    sizeBytes: b.sizeBytes,
  }))
  return Response.json({ backups: out })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')
  if (me.role !== 'admin') return jsonError(403, 'admins only')

  const { id: rawId } = await params
  const target = await resolveUser(rawId)
  if (!target) return jsonError(404, 'user not found')

  let body: { action?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }
  if (!body.action) return jsonError(400, 'action is required')

  const VALID_ACTIONS = ['deactivate', 'activate', 'promote', 'demote', 'force_logout', 'reset_link', 'login_as', 'delete', 'backup']
  if (!VALID_ACTIONS.includes(body.action)) {
    return jsonError(400, `action must be one of: ${VALID_ACTIONS.join(', ')}`)
  }

  // Don't allow admin to act on themselves (except 'backup' which is safe)
  if (target.id === me.id && body.action !== 'backup') {
    return jsonError(400, 'cannot perform this action on yourself')
  }

  switch (body.action) {
    case 'deactivate': {
      if (!target.isActive) return jsonError(400, 'user is already deactivated')
      await updateUser({ id: target.id, isActive: false })
      await deleteSessionsByUser(target.id)
      await logAdminAction({
        id: generateId(), actorId: me.id, targetId: target.id,
        action: 'deactivate', details: null,
      })
      return Response.json({ ok: true, isActive: false })
    }
    case 'activate': {
      if (target.isActive) return jsonError(400, 'user is already active')
      await updateUser({ id: target.id, isActive: true, forceLogoutAt: null })
      await logAdminAction({
        id: generateId(), actorId: me.id, targetId: target.id,
        action: 'activate', details: null,
      })
      return Response.json({ ok: true, isActive: true })
    }
    case 'promote': {
      if (target.role === 'admin') return jsonError(400, 'user is already an admin')
      const adminCount = await countAdmins()
      if (adminCount >= 2) return jsonError(400, 'Two admins max. Demote another admin first.')
      await updateUser({ id: target.id, role: 'admin' })
      await logAdminAction({
        id: generateId(), actorId: me.id, targetId: target.id,
        action: 'promote', details: null,
      })
      return Response.json({ ok: true, role: 'admin' })
    }
    case 'demote': {
      if (target.role !== 'admin') return jsonError(400, 'user is not an admin')
      const adminCount = await countAdmins()
      if (adminCount <= 1) return jsonError(400, 'At least one admin required.')
      await updateUser({ id: target.id, role: 'member' })
      await logAdminAction({
        id: generateId(), actorId: me.id, targetId: target.id,
        action: 'demote', details: null,
      })
      return Response.json({ ok: true, role: 'member' })
    }
    case 'force_logout': {
      await updateUser({ id: target.id, forceLogoutAt: new Date() })
      await deleteSessionsByUser(target.id)
      await logAdminAction({
        id: generateId(), actorId: me.id, targetId: target.id,
        action: 'force_logout', details: null,
      })
      return Response.json({ ok: true })
    }
    case 'reset_link': {
      const token = randomBytes(32).toString('hex')
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000)
      await updateUser({
        id: target.id,
        passwordResetToken: token,
        passwordResetExpires: expires,
        forceLogoutAt: new Date(),
      })
      await deleteSessionsByUser(target.id)
      await logAdminAction({
        id: generateId(), actorId: me.id, targetId: target.id,
        action: 'reset_link', details: { expiresAt: expires.toISOString() },
      })
      const resetUrl = `${new URL(req.url).origin}/?reset=${token}`
      return Response.json({ ok: true, resetUrl, expiresAt: expires.toISOString() })
    }
    case 'login_as': {
      const sessionToken = randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000)
      const { createSessionRow } = await import('@/lib/neon-sql')
      await createSessionRow({
        token: sessionToken,
        userId: target.id,
        expiresAt,
        impersonatedBy: me.id,
      })
      await logAdminAction({
        id: generateId(), actorId: me.id, targetId: target.id,
        action: 'login_as', details: { sessionExpiresAt: expiresAt.toISOString() },
      })
      return new Response(JSON.stringify({
        ok: true,
        user: { id: target.id, name: target.name, role: target.role },
        impersonatedBy: me.id,
        sessionExpiresAt: expiresAt.toISOString(),
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': sessionCookieHeader(sessionToken, expiresAt),
        },
      })
    }
    case 'delete': {
      if (target.role === 'admin') {
        const adminCount = await countAdmins()
        if (adminCount <= 1) return jsonError(400, 'Cannot delete the last admin.')
      }
      await logAdminAction({
        id: generateId(), actorId: me.id, targetId: target.id,
        action: 'delete', details: { name: target.name },
      })
      await deleteUserAndAllData(target.id)
      return Response.json({ ok: true })
    }
    case 'backup': {
      const payload = await exportUserPayload(target.id)
      const result = await createUserBackup({
        id: generateId(),
        userId: target.id,
        createdBy: me.id,
        payload,
      })
      await logAdminAction({
        id: generateId(), actorId: me.id, targetId: target.id,
        action: 'backup_user', details: { backupId: result.id, sizeBytes: result.sizeBytes },
      })
      return Response.json({
        ok: true,
        backupId: result.id,
        createdAt: result.createdAt instanceof Date ? result.createdAt.toISOString() : String(result.createdAt),
        sizeBytes: result.sizeBytes,
      })
    }
    default:
      return jsonError(400, `unhandled action: ${body.action}`)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')
  if (me.role !== 'admin') return jsonError(403, 'admins only')

  const { id: rawId } = await params
  const target = await resolveUser(rawId)
  if (!target) return jsonError(404, 'user not found')

  if (target.id === me.id) return jsonError(400, 'cannot delete yourself')
  if (target.role === 'admin') {
    const adminCount = await countAdmins()
    if (adminCount <= 1) return jsonError(400, 'Cannot delete the last admin.')
  }
  await logAdminAction({
    id: generateId(), actorId: me.id, targetId: target.id,
    action: 'delete', details: { name: target.name },
  })
  await deleteUserAndAllData(target.id)
  return Response.json({ ok: true })
}

async function resolveUser(idOrName: string) {
  // Try id first
  let u = await findUserById(idOrName)
  if (u) return u
  // Fall back to URL-decoded name
  return await findUserByName(decodeURIComponent(idOrName))
}
