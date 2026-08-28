import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { assembleLedgerRaw } from '@/lib/neon-sql'
import { LLM } from '@/lib/llm-server'
import { todayStr, isoDaysAgo } from '@/lib/dates'
import type { Ledger, DayT } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/suggestions
 *
 * Returns personalized question suggestions for the user to answer during
 * recording or manual entry. Uses LLM (with fallback chain) to generate
 * 3-5 questions based on the day's data.
 *
 * Falls back to a static list of generic questions if LLM is unavailable.
 */
export async function GET(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  try {
    const ledger = await assembleLedgerRaw(me.id)
    const today = todayStr()
    const day: DayT | undefined = ledger.days.find((d) => d.date === today)
    const yesterday = isoDaysAgo(1)
    const yesterdayDay: DayT | undefined = ledger.days.find((d) => d.date === yesterday)

    // Build context about the day
    const todayHours = day ? day.activities.reduce((s, a) => s + a.hours, 0) : 0
    const todayHabitsDone = day ? Object.values(day.habits).filter(Boolean).length : 0
    const todayHabitsTotal = ledger.habits.length
    const pendingTasks = ledger.goals.flatMap((g) => g.tasks).filter((t) => t.status !== 'done').length
    const overdueTasks = ledger.goals.flatMap((g) => g.tasks).filter((t) => t.status !== 'done' && t.urgent).length
    const upcomingDeadlines = ledger.importantDates.filter((d) => {
      const days = (new Date(d.date).getTime() - new Date(today).getTime()) / 86400000
      return days >= 0 && days <= 7
    })
    const inboxCount = ledger.inbox.length
    const yesterdayHighlight = yesterdayDay?.highlight ?? null

    const context = {
      today,
      todayHours,
      todayHabitsDone,
      todayHabitsTotal,
      pendingTasks,
      overdueTasks,
      upcomingDeadlines: upcomingDeadlines.map((d) => `${d.label} (${d.date})`),
      inboxCount,
      yesterdayHighlight,
      goals: ledger.goals.map((g) => `${g.name} (${g.id})`).slice(0, 5),
      habits: ledger.habits.map((h) => h.name).slice(0, 5),
    }

    const questions = await generateQuestions(me.id, context)
    return Response.json({ questions })
  } catch (err) {
    console.error('suggestions error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    return jsonError(500, `Suggestions failed: ${raw}`)
  }
}

async function generateQuestions(userId: string, ctx: Record<string, unknown>): Promise<string[]> {
  const system =
    'You generate thoughtful reflection questions for a personal time-tracking app called Ledger. ' +
    'The user is logging their day. Generate 3-5 short, specific questions they might want to answer ' +
    'in their day entry. Each question should be 1-2 sentences max, conversational, and reference ' +
    'specific data from their day (e.g. "You spent 2 hours on Deep Work — what made it click?" rather than generic "How was your day?"). ' +
    'Output ONLY a JSON array of strings. No prose, no markdown fences.'

  const user =
    `Today is ${ctx.today}. Here is what I know about the user's day so far:\n` +
    JSON.stringify(ctx, null, 2) + '\n\n' +
    'Generate 3-5 personalized reflection questions for them to consider.'

  try {
    const text = await LLM.chatJSON<string[]>(userId, system, user)
    if (Array.isArray(text) && text.length > 0) {
      return text.slice(0, 5).map((q) => String(q).slice(0, 200))
    }
  } catch (err) {
    console.warn('LLM suggestions failed, using fallback:', err instanceof Error ? err.message : err)
  }

  // Fallback static questions
  return fallbackQuestions(ctx)
}

function fallbackQuestions(ctx: Record<string, unknown>): string[] {
  const out: string[] = []
  const todayHours = Number(ctx.todayHours ?? 0)
  const pendingTasks = Number(ctx.pendingTasks ?? 0)
  const overdueTasks = Number(ctx.overdueTasks ?? 0)
  const inboxCount = Number(ctx.inboxCount ?? 0)
  const todayHabitsDone = Number(ctx.todayHabitsDone ?? 0)
  const todayHabitsTotal = Number(ctx.todayHabitsTotal ?? 0)

  if (todayHours === 0) {
    out.push('What is one small thing you want to remember about today?')
  } else {
    out.push(`You logged ${todayHours} hour${todayHours === 1 ? '' : 's'} today — what mattered most in that time?`)
  }
  if (overdueTasks > 0) {
    out.push(`You have ${overdueTasks} urgent task${overdueTasks === 1 ? '' : 's'} pending — what\'s blocking them?`)
  } else if (pendingTasks > 0) {
    out.push(`What's one task you'd like to make progress on tomorrow?`)
  }
  if (todayHabitsTotal > 0 && todayHabitsDone < todayHabitsTotal) {
    out.push(`You've done ${todayHabitsDone} of ${todayHabitsTotal} habits today — what got in the way of the rest?`)
  }
  if (inboxCount > 0) {
    out.push(`Your inbox has ${inboxCount} item${inboxCount === 1 ? '' : 's'} — anything you want to capture for tomorrow?`)
  }
  if (ctx.yesterdayHighlight) {
    out.push(`Yesterday you noted: "${ctx.yesterdayHighlight}". How does today connect to that?`)
  }
  if (out.length < 3) out.push('What surprised you today?')
  return out.slice(0, 5)
}
