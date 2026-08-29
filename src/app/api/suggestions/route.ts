import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { buildSuggestionsContext } from '@/lib/neon-sql'
import { LLM } from '@/lib/llm-server'
import { QuestionSetSchema } from '@/lib/schemas'
import { todayIn } from '@/lib/dates'

export const dynamic = 'force-dynamic'

/**
 * GET /api/suggestions
 *
 * Returns personalized question suggestions for the evening reflection.
 * P2-4 (the diet): the route used to pay assembleLedgerRaw (read everything
 * ever) per call for its context — now six scoped queries read ~100 rows.
 * Response shape unchanged; LLM down → static fallback questions still render.
 */
export async function GET(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  try {
    const today = todayIn(me.tz) // P1-5: the user's local day
    const context = await buildSuggestionsContext(me.id, today)
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
    'Output ONLY JSON: {"questions":["..."]}. No prose, no markdown fences.'

  const user =
    `Today is ${ctx.today}. Here is what I know about the user's day so far:\n` +
    JSON.stringify(ctx, null, 2) + '\n\n' +
    'Generate 3-5 personalized reflection questions for them to consider.'

  /* P3-2: strict zod contract, provider-native schema, one repair round,
   * 8s timeout, circuit breaker, budget. No 500s from malformed output. */
  try {
    const r = await LLM.generateJson({
      userId,
      route: 'suggestions',
      schema: QuestionSetSchema,
      system,
      user,
      maxTokens: 800,
    })
    if ('data' in r && r.data.questions.length > 0) {
      return r.data.questions.slice(0, 5).map((q) => q.slice(0, 200))
    }
    if ('error' in r && r.error === 'budget') {
      console.warn('suggestions: daily LLM budget reached — static fallback')
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
