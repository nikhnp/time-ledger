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
})
