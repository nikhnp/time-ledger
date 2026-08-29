import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { MergeDelta } from '@/lib/types'

/**
 * P1-4: merge is transactional — a mid-write failure must leave ZERO new
 * rows. Runs against a real Postgres (CI service container / Netlify build
 * TEST branch); self-skips without a postgres:// DATABASE_URL.
 */
const hasDb = /^postgres(ql)?:/.test(process.env.DATABASE_URL ?? '')

// Failure switch consumed by the mocked createActivity below.
let failOnLabel: string | null = null

vi.mock('@/lib/neon-sql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/neon-sql')>()
  return {
    ...actual,
    createActivity: async (
      p: Parameters<typeof actual.createActivity>[0],
      c?: unknown,
    ) => {
      if (failOnLabel && p.label === failOnLabel) throw new Error('injected failure')
      return actual.createActivity(p, c as never)
    },
  }
})

import { db } from '@/lib/db'
import { applyMergeDelta } from '@/lib/server/ledger'
import { createUser, createGoal } from '@/lib/neon-sql'
import { hashPassword } from '@/lib/server/auth'
import { randomBytes } from 'node:crypto'

const d = describe.skipIf(!hasDb)

const uname = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`

async function seedUserWithGoal() {
  const user = await createUser({
    id: `u-${randomBytes(8).toString('hex')}`,
    name: uname('merge'),
    role: 'member',
    passwordHash: hashPassword(randomBytes(16).toString('hex')),
  })
  await createGoal({ userId: user.id, id: 'deep-work', name: 'Deep work', unit: 'hours', target: 10, weeklyTargetHours: 5, sortOrder: 0 })
  return user
}

d('merge transactions (P1-4)', () => {
  beforeAll(async () => {
    // ensure tables exist (CI runs prisma migrate deploy before tests)
    await db.user.count()
  })

  it('a happy merge writes day + activities + notes together', async () => {
    const user = await seedUserWithGoal()

    const res = await applyMergeDelta(user.id, {
      date: '2026-08-28',
      highlight: 'transactional day',
      activities: [{ goalId: 'deep-work', hours: 2, label: 'build' }],
      newNotes: ['note one', 'note two'],
    } as MergeDelta)
    expect(res.counts.activities).toBe(1)
    expect(res.counts.notes).toBe(2)
    expect(res.skipped).toEqual([])

    const day = await db.day.findUnique({ where: { userId_date: { userId: user.id, date: new Date('2026-08-28T00:00:00Z') } } })
    expect(day?.highlight).toBe('transactional day')
    const notes = await db.note.findMany({ where: { userId: user.id } })
    expect(notes).toHaveLength(2)
  })

  it('a forced mid-write failure rolls back EVERYTHING (no partial day)', async () => {
    const user = await seedUserWithGoal()

    const beforeActivities = await db.activity.count({ where: { userId: user.id } })
    const beforeNotes = await db.note.count({ where: { userId: user.id } })
    const beforeDays = await db.day.count({ where: { userId: user.id } })

    failOnLabel = 'boom'
    try {
      await expect(
        applyMergeDelta(user.id, {
          date: '2026-08-29',
          highlight: 'should never persist',
          activities: [
            { goalId: 'deep-work', hours: 1, label: 'ok' },
            { goalId: 'deep-work', hours: 2, label: 'boom' },
          ],
          newNotes: ['should never exist'],
        } as MergeDelta),
      ).rejects.toThrow('injected failure')
    } finally {
      failOnLabel = null
    }

    // Nothing from the failed merge persisted
    expect(await db.activity.count({ where: { userId: user.id } })).toBe(beforeActivities)
    expect(await db.note.count({ where: { userId: user.id } })).toBe(beforeNotes)
    expect(await db.day.count({ where: { userId: user.id } })).toBe(beforeDays)
  })

  it('unknown goals/habits are skipped with reasons, not crashes', async () => {
    const user = await seedUserWithGoal()
    const res = await applyMergeDelta(user.id, {
      date: '2026-08-28',
      activities: [{ goalId: 'no-such-goal', hours: 1 }],
      habits: [{ habitId: 'no-such-habit', done: true }],
    } as MergeDelta)
    expect(res.counts.activities).toBe(0)
    expect(res.skipped).toHaveLength(2)
  })
  /* ---------- P2-9: dates[] land on their day ---------- */

  it('a merge with dates[] creates importantDates and counts them', async () => {
    const user = await seedUserWithGoal()
    const res = await applyMergeDelta(user.id, {
      date: '2026-08-28',
      dates: [
        { label: 'Quarterly report deadline', date: '2026-09-05', type: 'deadline' },
        { label: "Mom's birthday", date: '2026-09-10', type: 'birthday' },
      ],
    } as MergeDelta)
    expect(res.counts.dates).toBe(2)
    const rows = await db.importantDate.findMany({ where: { userId: user.id }, orderBy: { date: 'asc' } })
    expect(rows).toHaveLength(2)
    expect(rows[0].label).toBe('Quarterly report deadline')
    expect(rows[0].type).toBe('deadline')
  })

  it('invalid dates[] entries are skipped with reasons', async () => {
    const user = await seedUserWithGoal()
    const res = await applyMergeDelta(user.id, {
      date: '2026-08-28',
      dates: [
        { label: '', date: '2026-09-05', type: 'deadline' },
        { label: 'bad date', date: '2026-02-30', type: 'event' },
      ],
    } as MergeDelta)
    expect(res.counts.dates ?? 0).toBe(0)
    expect(res.skipped).toHaveLength(2)
  })

  /* ---------- P2-10: clientId idempotency ---------- */

  it('a replayed capture with the same clientId does not double-write', async () => {
    const user = await seedUserWithGoal()
    const delta = {
      date: '2026-08-28',
      activities: [{ goalId: 'deep-work', hours: 1.5, label: 'replay me', clientId: 'act_fixed_1' }],
      newNotes: [{ text: 'replayed note', clientId: 'note_fixed_1' }],
    } as MergeDelta
    const first = await applyMergeDelta(user.id, delta)
    expect(first.counts.activities).toBe(1)

    const replay = await applyMergeDelta(user.id, { ...delta, date: '2026-08-28' })
    expect(replay.counts.activities).toBe(1) // reported, but…

    const acts = await db.activity.findMany({ where: { userId: user.id, label: 'replay me' } })
    expect(acts).toHaveLength(1) // …only one row exists
    const notes = await db.note.findMany({ where: { userId: user.id, text: 'replayed note' } })
    expect(notes).toHaveLength(1)
  })

  /* ---------- P2-4: Day.plan ---------- */

  it('upsertDay persists and clears the plan', async () => {
    const user = await seedUserWithGoal()
    const { upsertDay, findDayByUserAndDate } = await import('@/lib/neon-sql')
    const d = new Date('2026-08-30T00:00:00Z')
    await upsertDay(user.id, d, { plan: [{ goalId: 'deep-work', hours: 2, note: 'morning' }] })
    const row = await findDayByUserAndDate(user.id, d)
    expect(row?.plan).toBeTruthy()
    const plan = JSON.parse(row!.plan as string) as Array<{ goalId: string; hours: number }>
    expect(plan[0].goalId).toBe('deep-work')
    expect(plan[0].hours).toBe(2)

    await upsertDay(user.id, d, { plan: null })
    const cleared = await findDayByUserAndDate(user.id, d)
    expect(cleared?.plan).toBeNull()
  })
})
