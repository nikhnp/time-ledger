import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import {
  findSessionWithUser,
  deleteSession as deleteSessionRow,
} from '@/lib/neon-sql'
import type { Role } from '@/lib/types'

export const SESSION_COOKIE = '__Host-ledger_session'
const SESSION_DAYS = 30

/**
 * P1-1c: sessions are stored as SHA-256 token hashes. The raw token lives
 * only in the cookie; the database can no longer be scraped for usable
 * credentials. (Migration recreates the Session table around `tokenHash`.)
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * P1-1a: passwords are scrypt-hashed (salt:hash). Kept from v10.3 — the
 * primitive was always fine; what was broken was accepting a NULL hash
 * (see the login route guard).
 */
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

/**
 * Anti-enumeration helper (P1-1d): burn comparable CPU for unknown users so
 * "unknown username" and "wrong password" are indistinguishable by timing.
 */
const DUMMY_HASH = hashPassword(randomBytes(32).toString('hex'))
export function burnPasswordCheck(): void {
  verifyPassword(randomBytes(16).toString('hex'), DUMMY_HASH)
}

export interface SessionUser {
  id: string
  name: string
  role: Role
  impersonatedBy?: string | null // v10: admin's user id, when impersonating
}

/**
 * P1-1c: the ONLY place that parses the session cookie. v10.3 had this regex
 * duplicated in three files (auth.ts x2, switch-back) — drift waiting to
 * happen, especially now that the cookie name changes to __Host-ledger_session.
 */
export function readSessionToken(req: Request): string | null {
  const cookie = req.headers.get('cookie') ?? ''
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))
  return m ? decodeURIComponent(m[1]) : null
}

/**
 * Reads the session cookie → the logged-in user (or null). Honors expiry,
 * admin force-logout, AND the isActive flag (deactivated users can't be
 * logged in).
 *
 * If the session was created via "login as user" (admin impersonation), the
 * impersonatedBy field on the session is preserved.
 */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const token = readSessionToken(req)
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

/**
 * P1-1c: `__Host-` prefix (browsers enforce: Secure, Path=/, no Domain) +
 * the Secure flag v10.3 was missing. Deployed over HTTPS on Netlify, so
 * Secure is always safe here.
 */
export function sessionCookieHeader(token: string, expiresAt: Date): string {
  const expires = expiresAt.toUTCString()
  return `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Expires=${expires}`
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`
}

/**
 * Destroy the session associated with the request's cookie.
 */
export async function destroySession(req: Request): Promise<void> {
  const token = readSessionToken(req)
  if (token) {
    await deleteSessionRow(token).catch(() => {})
  }
}

/**
 * Create a session row. Routes may also call createSessionRow from neon-sql
 * directly (it generates + hashes the token itself) — prefer that variant.
 */
export async function createSession(
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000)
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
