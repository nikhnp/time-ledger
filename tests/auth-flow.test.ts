import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * P1-1 regression suite — runs against a real Postgres (CI service container
 * or the Netlify build's TEST branch). Self-skips when DATABASE_URL is unset.
 *
 * Every security fix from the hardening bundle is pinned here:
 *  - null passwordHash can never log in (P1-1a)
 *  - 'resetpw' admin action is gone (P1-1a)
 *  - session tokens are stored hashed (P1-1c)
 *  - login is rate limited + non-enumerating (P1-1d)
 *  - password change requires the current password and revokes other
 *    sessions (P1-1d)
 */

// Only run against a real Postgres URL — this sandbox/CI exports
// DATABASE_URL, but SQLite-style URLs (or none) mean "no DB suites".
const hasDb = /^postgres(ql)?:/.test(process.env.DATABASE_URL ?? '')
const d = describe.skipIf(!hasDb)

let db: import('@prisma/client').PrismaClient
let POST_login: typeof import('@/app/api/auth/login/route').POST
let POST_signup: typeof import('@/app/api/auth/signup/route').POST
let PATCH_users: typeof import('@/app/api/users/[name]/route').PATCH
let POST_password: typeof import('@/app/api/account/password/route').POST

const req = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) => new NextRequest(`http://localhost${url}`, init)
const jsonReq = (url: string, body: unknown, cookie?: string) =>
  req(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })

function tokenFrom(setCookie: string | null): string {
  const m = setCookie?.match(/__Host-ledger_session=([^;]+)/)
  if (!m) throw new Error(`no session cookie in response: ${setCookie}`)
  return decodeURIComponent(m[1])
}

const uname = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`

beforeAll(async () => {
  const { PrismaClient } = await import('@prisma/client')
  db = new PrismaClient()
  ;({ POST: POST_login } = await import('@/app/api/auth/login/route'))
  ;({ POST: POST_signup } = await import('@/app/api/auth/signup/route'))
  ;({ PATCH: PATCH_users } = await import('@/app/api/users/[name]/route'))
  ;({ POST: POST_password } = await import('@/app/api/account/password/route'))
})

afterAll(async () => {
  if (db) await db.$disconnect()
})

async function seedUser(name: string, password: string) {
  const { hashPassword } = await import('@/lib/server/auth')
  const { randomBytes } = await import('node:crypto')
  return db.user.create({
    data: { id: `u-${randomBytes(8).toString('hex')}`, name, passwordHash: hashPassword(password) },
  })
}

d('login (P1-1a/d)', () => {
  it('accepts a valid password and sets a Secure __Host- session cookie', async () => {
    const name = uname('goodlogin')
    await seedUser(name, 'correct-horse-8')
    const res = await POST_login(jsonReq('/api/auth/login', { name, password: 'correct-horse-8' }))
    expect(res.status).toBe(200)
    const sc = res.headers.get('set-cookie') ?? ''
    expect(sc).toContain('__Host-ledger_session=')
    expect(sc).toContain('Secure')
    expect(sc).toContain('HttpOnly')
    expect(sc).toContain('SameSite=Lax')
  })

  it('rejects a wrong password with 401', async () => {
    const name = uname('wrongpw')
    await seedUser(name, 'correct-horse-8')
    const res = await POST_login(jsonReq('/api/auth/login', { name, password: 'wrong-password' }))
    expect(res.status).toBe(401)
  })

  it('returns the SAME error for unknown users (non-enumeration)', async () => {
    const good = await POST_login(
      jsonReq('/api/auth/login', { name: uname('realuser'), password: 'nope-nope-nope' }),
    )
    const unknown = await POST_login(
      jsonReq('/api/auth/login', { name: uname('ghost'), password: 'nope-nope-nope' }),
    )
    expect(good.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(await good.json()).toEqual(await unknown.json())
  })

  it('a null passwordHash user can NEVER log in (P1-1a)', async () => {
    const name = uname('nullhash')
    const u = await seedUser(name, 'temp-password-1')
    await db.user.update({ where: { id: u.id }, data: { passwordHash: null as unknown as string } })
    for (const pw of ['temp-password-1', '', 'anything']) {
      const res = await POST_login(jsonReq('/api/auth/login', { name, password: pw }))
      expect([401, 403]).toContain(res.status)
      expect(res.status).not.toBe(200)
    }
  })

  it('rate limits login to 5 attempts / 15 min per ip+username', async () => {
    const name = uname('ratelimit')
    await seedUser(name, 'whatever-pass-1')
    let last = 0
    for (let i = 0; i < 6; i++) {
      last = (await POST_login(jsonReq('/api/auth/login', { name, password: 'definitely-wrong' }))).status
    }
    expect(last).toBe(429)
  })
})

d('signup (P1-1d)', () => {
  it('enforces the 8-character minimum', async () => {
    const res = await POST_signup(jsonReq('/api/auth/signup', { name: uname('shorty'), password: 'short1' }))
    expect(res.status).toBe(400)
  })

  it('stores the session token HASHED, never plaintext (P1-1c)', async () => {
    const name = uname('hashedtok')
    const res = await POST_signup(jsonReq('/api/auth/signup', { name, password: 'long-enough-pw' }))
    expect(res.status).toBe(200)
    const raw = tokenFrom(res.headers.get('set-cookie'))
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(raw).digest('hex')
    const row = await db.session.findUnique({ where: { tokenHash: hash } })
    expect(row).not.toBeNull()
    const plaintext = await db.session.findUnique({ where: { tokenHash: raw } })
    expect(plaintext).toBeNull()
  })
})

d('admin actions (P1-1a)', () => {
  it("'resetpw' is retired — returns 400 unknown action", async () => {
    const adminName = uname('admin')
    const admin = await seedUser(adminName, 'admin-pass-123')
    await db.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
    const target = await seedUser(uname('victim'), 'victim-pass-1')

    const loginRes = await POST_login(jsonReq('/api/auth/login', { name: adminName, password: 'admin-pass-123' }))
    const cookieName = '__Host-ledger_session'
    const cookie = `${cookieName}=${encodeURIComponent(tokenFrom(loginRes.headers.get('set-cookie')))}`

    const patchReq = () =>
      new NextRequest(`http://localhost/api/users/${target.name}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ action: 'resetpw' }),
      })
    const res = await PATCH_users(patchReq(), { params: Promise.resolve({ name: target.name }) })
    expect(res.status).toBe(400)

    // the victim's hash must be untouched
    const after = await db.user.findUnique({ where: { id: target.id } })
    expect(after?.passwordHash).not.toBeNull()
  })
})

d('password change (P1-1d)', () => {
  it('requires the CURRENT password and revokes other sessions', async () => {
    const name = uname('pwchange')
    const u = await seedUser(name, 'old-password-1')

    const login1 = await POST_login(jsonReq('/api/auth/login', { name, password: 'old-password-1' }))
    const login2 = await POST_login(jsonReq('/api/auth/login', { name, password: 'old-password-1' }))
    const c1 = `__Host-ledger_session=${encodeURIComponent(tokenFrom(login1.headers.get('set-cookie')))}`
    const token2 = tokenFrom(login2.headers.get('set-cookie'))

    // wrong current password → 403
    const bad = await POST_password(
      jsonReq('/api/account/password', { currentPassword: 'WRONG', password: 'new-password-9' }, c1),
    )
    expect(bad.status).toBe(403)

    // correct → ok
    const ok = await POST_password(
      jsonReq('/api/account/password', { currentPassword: 'old-password-1', password: 'new-password-9' }, c1),
    )
    expect(ok.status).toBe(200)

    // the OTHER session is dead; the current one still resolves
    const { getSessionUser } = await import('@/lib/server/auth')
    const other = await getSessionUser(new NextRequest('http://localhost/x', {
      headers: { cookie: `__Host-ledger_session=${encodeURIComponent(token2)}` },
    }))
    expect(other).toBeNull()
    const mine = await getSessionUser(new NextRequest('http://localhost/x', {
      headers: { cookie: c1 },
    }))
    expect(mine?.id).toBe(u.id)

    // old password no longer works, new one does
    expect((await POST_login(jsonReq('/api/auth/login', { name, password: 'old-password-1' }))).status).toBe(401)
    expect((await POST_login(jsonReq('/api/auth/login', { name, password: 'new-password-9' }))).status).toBe(200)
  })
})
