import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { db } from '@/lib/db'
import { s2d, d2s, todayStr } from '@/lib/dates'

export const dynamic = 'force-dynamic'

/**
 * GET /api/review/week?start=YYYY-MM-DD
 *
 * P3-1: the weekly review renders from EXACTLY ONE aggregate request —
 * zero full-ledger fetches. Monday-aligned (server-normalized: whatever
 * day you pass, its Monday is used). Numbers hit the P2-5 indexes:
 * Activity[userId,date], DayHabit[userId,habitId,date].
 */
export async function GET(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  const url = new URL(req.url)
  const param = url.searchParams.get('start')
  const base = param && /^\d{4}-\d{2}-\d{2}$/.test(param) && !isNaN(new Date(param + 'T00:00:00Z').getTime()) ? param : mondayOf(todayStr())
  const start = mondayOf(base)
  const endDate = new Date(s2d(start).getTime() + 6 * 86400000)
  const end = d2s(endDate)
  const startDate = s2d(start)

  /* 70 days back for streak computation (consecutive days ending today) */
  const streakStart = new Date(startDate.getTime() - 70 * 86400000)

  const [goals, habits, acts, dayHabits, days, notes, screens] = await Promise.all([
    db.goal.findMany({ where: { userId: me.id }, orderBy: { sortOrder: 'asc' } }),
    db.habit.findMany({ where: { userId: me.id }, orderBy: { sortOrder: 'asc' } }),
    db.activity.findMany({
      where: { userId: me.id, date: { gte: startDate, lte: endDate } },
      select: { goalId: true, hours: true, label: true, date: true },
    }),
    db.dayHabit.findMany({
      where: { userId: me.id, date: { gte: streakStart, lte: endDate } },
      select: { habitId: true, date: true, done: true },
    }),
    db.day.findMany({
      where: { userId: me.id, date: { gte: startDate, lte: endDate } },
      select: { date: true, checkIn: true, plan: true },
    }),
    db.note.count({ where: { userId: me.id, date: { gte: startDate, lte: endDate } } }),
    db.screenEntry.findMany({
      where: { userId: me.id, date: { gte: startDate, lte: endDate } },
      select: { category: true, minutes: true },
    }),
  ])

  /* hours per pursuit + top labels + per-goal done hours */
  const hoursByGoal = new Map<string, number>()
  const hoursByLabel = new Map<string, number>()
  const doneByGoalByDate = new Map<string, Map<string, number>>()
  let totalHours = 0
  const activeDates = new Set<string>()
  for (const a of acts) {
    const gid = a.goalId ?? 'none'
    hoursByGoal.set(gid, (hoursByGoal.get(gid) ?? 0) + a.hours)
    if (a.label) hoursByLabel.set(a.label, (hoursByLabel.get(a.label) ?? 0) + a.hours)
    totalHours += a.hours
    const ds = d2s(a.date)
    activeDates.add(ds)
    let perDate = doneByGoalByDate.get(ds)
    if (!perDate) {
      perDate = new Map()
      doneByGoalByDate.set(ds, perDate)
    }
    perDate.set(gid, (perDate.get(gid) ?? 0) + a.hours)
  }

  const pursuits = goals.map((g) => {
    const hours = +(hoursByGoal.get(g.id) ?? 0).toFixed(2)
    return {
      id: g.id,
      name: g.name,
      kind: g.kind === 'hobby' ? 'hobby' : 'goal',
      hours,
      weeklyTargetHours: g.weeklyTargetHours,
      hit: hours >= g.weeklyTargetHours,
      deadlineInDays: g.deadline
        ? Math.round((g.deadline.getTime() - startDate.getTime()) / 86400000)
        : null,
    }
  })
  const unassignedHours = +(hoursByGoal.get('none') ?? 0).toFixed(2)

  /* habit hit-rate + streak (consecutive done days ending today) */
  const todayD = s2d(todayStr())
  const doneByHabit = new Map<string, Set<string>>()
  for (const h of dayHabits) {
    if (!h.done) continue
    let set = doneByHabit.get(h.habitId)
    if (!set) {
      set = new Set()
      doneByHabit.set(h.habitId, set)
    }
    set.add(d2s(h.date))
  }
  const weekDates = Array.from({ length: 7 }, (_, i) => d2s(new Date(startDate.getTime() + i * 86400000)))
  const habitRows = habits.map((h) => {
    const doneSet = doneByHabit.get(h.id) ?? new Set<string>()
    const hits = weekDates.filter((d) => doneSet.has(d)).length
    /* streak: walk back from today while done */
    let streak = 0
    const cur = new Date(todayD)
    while (doneSet.has(d2s(cur))) {
      streak++
      cur.setUTCDate(cur.getUTCDate() - 1)
    }
    return { id: h.id, name: h.name, archived: h.archived, hits, targetPerWeek: h.targetPerWeek, streak }
  })

  /* planned vs done (P2-4's report card): Day.plan written FOR this day */
  const plannedByGoal = new Map<string, number>()
  const doneByGoal = new Map<string, number>()
  let planCount = 0
  for (const d of days) {
    let plan: Array<{ goalId: string | null; hours: number }> | null = null
    try {
      plan = d.plan ? (JSON.parse(d.plan) as Array<{ goalId: string | null; hours: number }>) : null
    } catch {
      plan = null
    }
    if (!plan || plan.length === 0) continue
    planCount++
    const ds = d2s(d.date)
    for (const p of plan) {
      const key = p.goalId ?? 'free'
      plannedByGoal.set(key, (plannedByGoal.get(key) ?? 0) + (p.hours || 0))
      const done = doneByGoalByDate.get(ds)?.get(key) ?? 0
      doneByGoal.set(key, (doneByGoal.get(key) ?? 0) + done)
    }
  }
  const plannedVsDone = Array.from(new Set([...plannedByGoal.keys(), ...doneByGoal.keys()])).map((key) => ({
    goalId: key,
    name: key === 'free' ? 'Free intent' : goals.find((g) => g.id === key)?.name ?? key,
    planned: +(plannedByGoal.get(key) ?? 0).toFixed(2),
    done: +(doneByGoal.get(key) ?? 0).toFixed(2),
  }))

  const screenByCat = new Map<string, number>()
  let screenTotal = 0
  for (const s of screens) {
    screenByCat.set(s.category, (screenByCat.get(s.category) ?? 0) + s.minutes)
    screenTotal += s.minutes
  }
  const topScreen = Array.from(screenByCat.entries()).sort((a, b) => b[1] - a[1])[0]

  const checkInCount = days.filter((d) => d.checkIn).length

  return Response.json({
    start,
    end,
    pursuits,
    unassignedHours,
    habits: habitRows,
    topActivities: Array.from(hoursByLabel.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, hours]) => ({ label, hours: +hours.toFixed(2) })),
    totals: { hours: +totalHours.toFixed(2), activeDays: activeDates.size },
    noteCount: notes,
    checkInCount,
    planCount,
    plannedVsDone,
    screen: {
      totalMinutes: screenTotal,
      topCategory: topScreen ? { category: topScreen[0], minutes: topScreen[1] } : null,
    },
    /** honest empty-state guard: the view renders this for zero weeks */
    empty: totalHours === 0 && notes === 0 && checkInCount === 0 && habitRows.every((h) => h.hits === 0),
  })
}

/** Monday-aligned week containing `s`. */
function mondayOf(s: string): string {
  const d = s2d(s)
  const shift = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - shift)
  return d2s(d)
}
