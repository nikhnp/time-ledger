import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import {
  findSessionWithUser,
  deleteSession as deleteSessionRow,
} from '@/lib/neon-sql'
import type { Role } from '@/lib/types'

export const SESSION_COOKIE = 'ledger_session'
const SESSION_DAYS = 30

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(pw, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export interface SessionUser {
  id: string
  name: string
  role: Role
  impersonatedBy?: string | null // v10: admin's user id, when impersonating
}

/**
 * Reads the session cookie → the logged-in user (or null). Honors expiry, admin
 * force-logout, AND v10's isActive flag (deactivated users can't be logged in).
 *
 * If the session was created via "login as user" (admin impersonation), the
 * impersonatedBy field on the session is preserved.
 */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const cookie = req.headers.get('cookie') ?? ''
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))
  const token = m ? decodeURIComponent(m[1]) : null
  if (!token) return null

  const result = await findSessionWithUser(token)
  if (!result) return null
  const { session, user } = result

  if (session.expiresAt < new Date()) {
    await deleteSessionRow(token).catch(() => {})
    return null
  }
  if (user.forceLogoutAt && session.createdAt < user.forceLogoutAt) {
    await deleteSessionRow(token).catch(() => {})
    return null
  }
  // v10: deactivated users can't be logged in (UNLESS impersonated by an admin)
  if (!user.isActive && !session.impersonatedBy) {
    await deleteSessionRow(token).catch(() => {})
    return null
  }
  return {
    id: user.id,
    name: user.name,
    role: user.role === 'admin' ? 'admin' : 'member',
    impersonatedBy: session.impersonatedBy ?? null,
  }
}

export function sessionCookieHeader(token: string, expiresAt: Date): string {
  const expires = expiresAt.toUTCString()
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

/**
 * Destroy the session associated with the request's cookie.
 * v9: uses raw SQL deleteSession.
 */
export async function destroySession(req: Request): Promise<void> {
  const cookie = req.headers.get('cookie') ?? ''
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))
  if (m) {
    const token = decodeURIComponent(m[1])
    await deleteSessionRow(token).catch(() => {})
  }
}

/**
 * Create a session row. Kept for compatibility — but v8+ routes use createSessionRow
 * from neon-sql directly (with explicit token + expiresAt generation).
 */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000)
  // Import lazily to avoid circular dependency at module load time
  const { createSessionRow } = await import('@/lib/neon-sql')
  await createSessionRow({ token, userId, expiresAt })
  return { token, expiresAt }
}

/** JSON error helper for API routes */
export function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
