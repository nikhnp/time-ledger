import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { assembleLedgerRaw, findScreenEntriesByRange } from '@/lib/neon-sql'
import { LLM } from '@/lib/llm-server'
import { RecommendationListSchema } from '@/lib/schemas'
import { todayStr, isoDaysAgo } from '@/lib/dates'
import type { EntryRecommendation } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/recommendations
 *
 * LLM-powered ideas for what to record or write about, shown when the Add
 * sheet opens. Each item: { kind: 'activity'|'habit'|'note'|'checkin'|'screen', text, goalId?, minutes? }.
 *
 * If no LLM is configured (or it fails), falls back to ledger-aware
 * heuristics: missing check-in, untouched habits, urgent tasks, no screen
 * time logged today.
 */
export async function GET(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  try {
    const ledger = await assembleLedgerRaw(me.id)
    const t = todayStr()
    const day = ledger.days.find((d) => d.date === t)
    const ctx = buildContext(ledger, day, t)

    /* try the LLM first */
    try {
      const recs = await generateWithLLM(me.id, ctx)
      if (recs.length > 0) return Response.json({ recommendations: recs, source: 'llm' })
    } catch (err) {
      console.warn('LLM recommendations failed, using fallback:', err instanceof Error ? err.message : err)
    }

    return Response.json({ recommendations: fallbackRecommendations(ledger, day, t), source: 'heuristic' })
  } catch (err) {
    console.error('recommendations error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    return jsonError(500, `Recommendations failed: ${raw}`)
  }
}

/* ---------- context building ---------- */

type LedgerT = Awaited<ReturnType<typeof assembleLedgerRaw>>
type DayT = LedgerT['days'][number]

function buildContext(ledger: LedgerT, day: DayT | undefined, t: string) {
  const todayHours = day ? day.activities.reduce((s, a) => s + a.hours, 0) : 0
  const undoneHabits = ledger.habits.filter((h) => !h.archived && !(day?.habits[h.id]))
  const pendingTasks = ledger.tasks.filter((tk) => tk.status !== 'done')
  const upcoming = ledger.importantDates.filter((d) => {
    const days = (new Date(d.date).getTime() - new Date(t).getTime()) / 86400000
    return days >= 0 && days <= 7
  })
  const yesterday = ledger.days.find((d) => d.date === isoDaysAgo(1))
  const yesterdayHours = yesterday ? yesterday.activities.reduce((s, a) => s + a.hours, 0) : 0
  return {
    today: t,
    checkInDone: !!day?.checkIn,
    todayHours,
    yesterdayHours,
    loggedToday: !!day && day.activities.length > 0,
    habits: ledger.habits.map((h) => ({ id: h.id, name: h.name, doneToday: !!day?.habits[h.id] })),
    undoneHabits: undoneHabits.map((h) => h.name),
    goals: ledger.goals.map((g) => ({ id: g.id, name: g.name, weeklyTargetHours: g.weeklyTargetHours })),
    pendingTasks: pendingTasks.slice(0, 6).map((tk) => tk.label),
    upcomingDeadlines: upcoming.map((d) => `${d.label} (${d.date})`),
    inboxCount: ledger.inbox.length,
    recentNotes: ledger.notes.slice(-5).map((n) => n.text.slice(0, 80)),
  }
}

/* ---------- LLM path ---------- */

async function generateWithLLM(userId: string, ctx: Record<string, unknown>): Promise<EntryRecommendation[]> {
  const system =
    'You suggest what a person should record in their time-tracking journal right now. ' +
    'Look at their day-so-far context and propose 2-4 short, concrete entries they could log — ' +
    'activities they likely did but have not recorded, habits left unchecked, a reflection to write, ' +
    'or screen time to note. Phrase each as a short action they can tap, e.g. ' +
    '"Log the 40 minutes you spent reading after lunch" or "How did the presentation prep feel?". ' +
    'Output ONLY a JSON array of objects: [{"kind":"activity|habit|note|checkin|screen","text":"...","goalId":"<id if activity>"}]. ' +
    'Use goalId only when the kind is activity and you can infer which goal. No prose, no markdown fences.'

  const user =
    `Today is ${ctx.today}. Here is the user's day-so-far context:\n` +
    JSON.stringify(ctx, null, 2) +
    '\n\nSuggest 2-4 things they should record now.'

  /* P3-2: strict zod contract via generateJson — schema-constrained decode,
   * one repair round, timeout, breaker, budget; malformed output can never
   * 500 this route (the heuristic fallback is the floor). */
  const r = await LLM.generateJson({
    userId,
    route: 'recommendations',
    schema: RecommendationListSchema,
    system,
    user,
    maxTokens: 700,
  })
  if ('error' in r) return []
  const out: EntryRecommendation[] = []
  for (const item of r.data.recommendations.slice(0, 4)) {
    if (!item.text.trim()) continue
    const goalId =
      typeof item.goalId === 'string' && Array.isArray(ctx.goals)
        ? (ctx.goals as Array<{ id: string }>).find((g) => g.id === item.goalId)?.id
        : undefined
    out.push({ kind: item.kind, text: item.text.trim().slice(0, 140), goalId })
  }
  return out
}

/* ---------- heuristic fallback ---------- */

function fallbackRecommendations(ledger: LedgerT, day: DayT | undefined, t: string): EntryRecommendation[] {
  const out: EntryRecommendation[] = []

  if (!day?.checkIn) {
    out.push({ kind: 'checkin', text: 'No check-in yet — what was today\u2019s one thing?' })
  }
  if (!day || day.activities.length === 0) {
    out.push({ kind: 'activity', text: 'Nothing logged today — add what you worked on', goalId: ledger.goals[0]?.id })
  }
  const undone = ledger.habits.filter((h) => !h.archived && !(day?.habits[h.id])).slice(0, 1)
  for (const h of undone) {
    out.push({ kind: 'habit', text: `\u201C${h.name}\u201D isn\u2019t checked off yet — did it happen today?` })
  }
  const urgent = ledger.tasks
    .filter((tk) => tk.status !== 'done' && tk.urgent)
    .slice(0, 1)
    .map((tk) => ({ tk, g: { name: ledger.goals.find((gg) => gg.id === tk.goalId)?.name ?? 'no goal' } }))
  for (const { tk, g } of urgent) {
    out.push({ kind: 'note', text: `Urgent: \u201C${tk.label}\u201D (${g.name}) — jot where it stands` })
  }
  if (out.length < 2) {
    out.push({ kind: 'screen', text: 'Log today\u2019s screen time — which apps ate the hours?' })
  }
  return out.slice(0, 4)
}
