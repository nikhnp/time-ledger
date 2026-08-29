import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * P2-1 delta-sync suite — runs against a real Postgres (CI service container
 * or the Netlify build's TEST branch). Self-skips when DATABASE_URL is unset.
 *
 * Pins the new mutation contract end-to-end:
 *  - every mutation responds { cursor, patch, deleted } — NOT the full ledger
 *  - the patch covers exactly what changed (tasks, cascaded goal deletes,
 *    habit toggles folded into days, merge, notes, inbox done→delete)
 *  - GET /api/ledger?since=<cursor> returns the same delta later (multi-device)
 *  - a cursor below User.syncWatermark falls back to a FULL ledger (gap)
 *  - boot responses (login) carry the cursor
 */

const hasDb = /^postgres(ql)?:/.test(process.env.DATABASE_URL ?? '')
const d = describe.skipIf(!hasDb)

let db: import('@prisma/client').PrismaClient
let POST_signup: typeof import('@/app/api/auth/signup/route').POST
let GET_ledger: typeof import('@/app/api/ledger/route').GET
let POST_tasks: typeof import('@/app/api/tasks/route').POST
let DELETE_tasks: typeof import('@/app/api/tasks/[id]/route').DELETE
let POST_goals: typeof import('@/app/api/goals/route').POST
let DELETE_goals: typeof import('@/app/api/goals/[id]/route').DELETE
let POST_habits: typeof import('@/app/api/habits/route').POST
let DELETE_habits: typeof import('@/app/api/habits/[id]/route').DELETE
let POST_toggle: typeof import('@/app/api/habits/toggle/route').POST
let POST_notes: typeof import('@/app/api/notes/route').POST
let DELETE_notes: typeof import('@/app/api/notes/[id]/route').DELETE
let POST_inbox: typeof import('@/app/api/inbox/route').POST
let PATCH_inbox: typeof import('@/app/api/inbox/[id]/route').PATCH
let POST_merge: typeof import('@/app/api/merge/route').POST
let POST_login: typeof import('@/app/api/auth/login/route').POST

type Json = Record<string, unknown> & { cursor?: number; ledger?: unknown; patch?: Record<string, unknown[]>; deleted?: Record<string, unknown[]> }

const req = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) =>
  new NextRequest(`http://localhost${url}`, {
    ...init,
    headers: {
      // Each request comes from its own client IP: this suite signs up >3
      // users, and signup is rate limited to 3/hour per IP (P1-1d). Without
      // this, the 4th newUser() in the file gets a 429.
      'x-forwarded-for': `10.${(Math.random() * 250 + 1) | 0}.${(Math.random() * 250 + 1) | 0}.${(Math.random() * 250 + 1) | 0}`,
      ...(init.headers ?? {}),
    },
  })
const jsonReq = (url: string, body: unknown, cookie?: string, method = 'POST') =>
  req(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })
const getReq = (url: string, cookie: string) =>
  req(url, { headers: { cookie } })

function tokenFrom(setCookie: string | null): string {
  const m = setCookie?.match(/__Host-ledger_session=([^;]+)/)
  if (!m) throw new Error(`no session cookie in response: ${setCookie}`)
  return decodeURIComponent(m[1])
}

const uname = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`

/** Sign a fresh user up; returns their session cookie, name + signup cursor. */
async function newUser(prefix: string): Promise<{ cookie: string; name: string; cursor: number }> {
  const name = uname(prefix)
  const res = await POST_signup(jsonReq('/api/auth/signup', { name, password: 'pw-delta-1', tz: 'UTC' }))
  expect(res.status).toBe(200)
  const data = (await res.json()) as Json
  return { cookie: `__Host-ledger_session=${tokenFrom(res.headers.get('set-cookie'))}`, name, cursor: data.cursor ?? 0 }
}

beforeAll(async () => {
  const { PrismaClient } = await import('@prisma/client')
  db = new PrismaClient()
  ;({ POST: POST_signup } = await import('@/app/api/auth/signup/route'))
  ;({ GET: GET_ledger } = await import('@/app/api/ledger/route'))
  ;({ POST: POST_tasks } = await import('@/app/api/tasks/route'))
  ;({ DELETE: DELETE_tasks } = await import('@/app/api/tasks/[id]/route'))
  ;({ POST: POST_goals } = await import('@/app/api/goals/route'))
  ;({ DELETE: DELETE_goals } = await import('@/app/api/goals/[id]/route'))
  ;({ POST: POST_habits } = await import('@/app/api/habits/route'))
  ;({ DELETE: DELETE_habits } = await import('@/app/api/habits/[id]/route'))
  ;({ POST: POST_toggle } = await import('@/app/api/habits/toggle/route'))
  ;({ POST: POST_notes } = await import('@/app/api/notes/route'))
  ;({ DELETE: DELETE_notes } = await import('@/app/api/notes/[id]/route'))
  ;({ POST: POST_inbox } = await import('@/app/api/inbox/route'))
  ;({ PATCH: PATCH_inbox } = await import('@/app/api/inbox/[id]/route'))
  ;({ POST: POST_merge } = await import('@/app/api/merge/route'))
  ;({ POST: POST_login } = await import('@/app/api/auth/login/route'))
})

afterAll(async () => {
  if (db) await db.$disconnect()
})

d('P2-1 delta sync', () => {
  it('task create responds with a patch, not the full ledger', async () => {
    const { cookie, cursor } = await newUser('deltask')
    const res = await POST_tasks(jsonReq('/api/tasks', { label: 'write the delta suite' }, cookie))
    expect(res.status).toBe(200)
    const data = (await res.json()) as Json & { patch?: { tasks?: Array<{ id: string; label: string }> } }
    expect(data.ledger).toBeUndefined()
    expect(typeof data.cursor).toBe('number')
    expect(data.cursor!).toBeGreaterThan(cursor)
    expect(data.patch?.tasks).toHaveLength(1)
    expect(data.patch?.tasks?.[0].label).toBe('write the delta suite')
    expect(data.patch?.goals).toBeUndefined() // untouched slices are omitted
  })

  it('GET /api/ledger?since= replays the same delta for another device', async () => {
    const { cookie, cursor } = await newUser('delsync')
    const created = await POST_tasks(jsonReq('/api/tasks', { label: 'replay me' }, cookie))
    const createdData = (await created.json()) as Json & { patch?: { tasks?: Array<{ id: string }> } }
    const taskId = createdData.patch?.tasks?.[0].id

    const delta = await GET_ledger(getReq('/api/ledger?since=' + cursor, cookie))
    expect(delta.status).toBe(200)
    const dd = (await delta.json()) as Json & { patch?: { tasks?: Array<{ id: string; label: string }> } }
    expect(dd.ledger).toBeUndefined()
    expect(dd.patch?.tasks?.some((t) => t.id === taskId)).toBe(true)

    // full ledger agrees with the patch (DB is truth)
    const full = await GET_ledger(getReq('/api/ledger', cookie))
    const fd = (await full.json()) as Json & { ledger?: { tasks: Array<{ id: string }>; cursor?: number } }
    expect(fd.ledger?.tasks.some((t) => t.id === taskId)).toBe(true)
    expect(typeof fd.cursor).toBe('number')

    // cursor up to date → empty patch, no full ledger
    const fresh = await GET_ledger(getReq('/api/ledger?since=' + fd.cursor, cookie))
    const fr = (await fresh.json()) as Json
    expect(fr.ledger).toBeUndefined()
    expect(fr.patch && Object.keys(fr.patch).length > 0).not.toBe(true)
  })

  it('goal delete surfaces cascaded tasks in `deleted`', async () => {
    const { cookie } = await newUser('delgoal')
    const goalRes = await POST_goals(jsonReq('/api/goals', { name: 'Cascade Test' }, cookie))
    const goalData = (await goalRes.json()) as Json & { patch?: { goals?: Array<{ id: string }> } }
    const goalId = goalData.patch?.goals?.[0].id
    expect(goalId).toBeTruthy()

    const taskRes = await POST_tasks(jsonReq('/api/tasks', { label: 'cascades away', goalId }, cookie))
    const taskData = (await taskRes.json()) as Json & { patch?: { tasks?: Array<{ id: string }> } }
    const taskId = taskData.patch?.tasks?.[0].id
    expect(taskId).toBeTruthy()

    const del = await DELETE_goals(
      req('/api/goals/x', { method: 'DELETE', headers: { cookie } }),
      { params: Promise.resolve({ id: goalId! }) },
    )
    expect(del.status).toBe(200)
    const dd = (await del.json()) as Json
    expect(dd.ledger).toBeUndefined()
    expect(dd.deleted?.goals).toContain(goalId)
    expect(dd.deleted?.tasks).toContain(taskId)

    const full = await GET_ledger(getReq('/api/ledger', cookie))
    const fd = (await full.json()) as Json & { ledger?: { goals: Array<{ id: string }>; tasks: Array<{ id: string }> } }
    expect(fd.ledger?.goals.some((g) => g.id === goalId)).toBe(false)
    expect(fd.ledger?.tasks.some((t) => t.id === taskId)).toBe(false)
  })

  it('habit toggle folds into patch.days; habit delete re-folds affected days', async () => {
    const { cookie } = await newUser('delhabit')
    const habitRes = await POST_habits(jsonReq('/api/habits', { name: 'stretch' }, cookie))
    const habitData = (await habitRes.json()) as Json & { patch?: { habits?: Array<{ id: string }> } }
    const habitId = habitData.patch?.habits?.[0].id
    expect(habitId).toBeTruthy()

    const today = new Date().toISOString().slice(0, 10)
    const tog = await POST_toggle(jsonReq('/api/habits/toggle', { habitId, date: today, done: true }, cookie))
    const togData = (await tog.json()) as Json & { done?: boolean; patch?: { days?: Array<{ date: string; habits: Record<string, boolean> }> } }
    expect(togData.done).toBe(true)
    expect(togData.patch?.days).toHaveLength(1)
    expect(togData.patch?.days?.[0].habits[habitId!]).toBe(true)

    const del = await DELETE_habits(
      req('/api/habits/x', { method: 'DELETE', headers: { cookie } }),
      { params: Promise.resolve({ id: habitId! }) },
    )
    const delData = (await del.json()) as Json & { deleted?: { habits?: string[] }; patch?: { days?: Array<{ date: string; habits: Record<string, boolean> }> } }
    expect(delData.deleted?.habits).toContain(habitId)
    // the affected day is re-folded WITHOUT the habit's checks
    expect(delData.patch?.days?.[0].habits[habitId!]).toBeUndefined()
  })

  it('merge responds with re-folded days + results', async () => {
    const { cookie } = await newUser('delmerge')
    const today = new Date().toISOString().slice(0, 10)
    const res = await POST_merge(
      jsonReq('/api/merge', { date: today, activities: [{ hours: 1.5, label: 'deep work' }], newNotes: ['delta note'] }, cookie),
    )
    expect(res.status).toBe(200)
    const data = (await res.json()) as Json & {
      results?: Array<{ counts: { activities: number } }>
      patch?: { days?: Array<{ date: string; activities: Array<{ hours: number }> }>; notes?: Array<{ text: string }> }
    }
    expect(data.ledger).toBeUndefined()
    expect(data.results?.[0].counts.activities).toBe(1)
    expect(data.patch?.days?.[0].date).toBe(today)
    expect(data.patch?.days?.[0].activities[0].hours).toBe(1.5)
    expect(data.patch?.notes?.[0].text).toBe('delta note')
  })

  it('notes create + delete; inbox done behaves as delete', async () => {
    const { cookie } = await newUser('delnote')
    const noteRes = await POST_notes(jsonReq('/api/notes', { text: 'hello delta' }, cookie))
    const noteData = (await noteRes.json()) as Json & { noteId?: string; patch?: { notes?: Array<{ id: string }> } }
    const noteId = noteData.patch?.notes?.[0].id
    expect(noteId).toBeTruthy()

    const delNote = await DELETE_notes(
      req('/api/notes/x', { method: 'DELETE', headers: { cookie } }),
      { params: Promise.resolve({ id: noteId! }) },
    )
    const delNoteData = (await delNote.json()) as Json
    expect(delNoteData.deleted?.notes).toContain(noteId)

    const inboxRes = await POST_inbox(jsonReq('/api/inbox', { text: 'triage me' }, cookie))
    const inboxData = (await inboxRes.json()) as Json & { patch?: { inbox?: Array<{ id: string }> } }
    const inboxId = inboxData.patch?.inbox?.[0].id
    expect(inboxId).toBeTruthy()

    const doneRes = await PATCH_inbox(
      req('/api/inbox/x', { method: 'PATCH', headers: { cookie } }),
      { params: Promise.resolve({ id: inboxId! }) },
    )
    const doneData = (await doneRes.json()) as Json
    expect(doneData.deleted?.inbox).toContain(inboxId)
  })

  it('a cursor below the sync watermark falls back to a FULL ledger', async () => {
    const { cookie, cursor } = await newUser('delgap')
    await POST_tasks(jsonReq('/api/tasks', { label: 'gap filler' }, cookie))

    // simulate "changes the client never saw were pruned" (scoped to this
    // test's users so parallel suites on the shared CI database stay clean)
    await db.user.updateMany({
      where: { name: { startsWith: 'delgap-' } },
      data: { syncWatermark: cursor + 1000000 },
    })

    const res = await GET_ledger(getReq('/api/ledger?since=' + cursor, cookie))
    const data = (await res.json()) as Json
    expect(data.ledger).toBeDefined() // full fallback
    expect(data.patch).toBeUndefined()
  })

  it('login boots with the cursor', async () => {
    const name = uname('delboot')
    const signup = await POST_signup(jsonReq('/api/auth/signup', { name, password: 'pw-delta-1', tz: 'UTC' }))
    expect(signup.status).toBe(200)
    const bootCursor = ((await signup.json()) as Json).cursor ?? 0

    const res = await POST_login(jsonReq('/api/auth/login', { name, password: 'pw-delta-1' }))
    expect(res.status).toBe(200)
    const data = (await res.json()) as Json
    expect(typeof data.cursor).toBe('number')
    expect(data.cursor!).toBeGreaterThanOrEqual(bootCursor)
  })
})
