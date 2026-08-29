/* P3-2: LLM ops helpers shared by the chat route and the settings panel —
 * the daily token budget counter and call logging for client-driven calls
 * (structureDay / extractDate / writeWords go through /api/llm/chat). */

import { db } from '@/lib/db'

const CHAR_PER_TOKEN = 4 // rough estimate — the budget is a brake, not an invoice

export function budgetLimit(): number {
  const n = Number(process.env.LLM_DAILY_TOKEN_BUDGET)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 50_000
}

export async function llmBudgetStatus(userId: string): Promise<{ used: number; limit: number; exceeded: boolean }> {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const agg = await db.llmCall.aggregate({
    where: { userId, createdAt: { gte: start } },
    _sum: { promptTokens: true, completionTokens: true },
  })
  const used = (agg._sum.promptTokens ?? 0) + (agg._sum.completionTokens ?? 0)
  const limit = budgetLimit()
  return { used, limit, exceeded: used >= limit }
}

export async function logClientLlmCall(row: {
  userId: string
  route: string
  ok: boolean
  latencyMs: number
  promptChars: number
  completionChars: number
}): Promise<void> {
  try {
    await db.llmCall.create({
      data: {
        userId: row.userId,
        route: row.route,
        provider: 'chain', // the chain resolved it; per-provider rows come from generateJson
        model: 'resolved-by-chain',
        promptTokens: Math.ceil(row.promptChars / CHAR_PER_TOKEN),
        completionTokens: Math.ceil(row.completionChars / CHAR_PER_TOKEN),
        latencyMs: row.latencyMs,
        ok: row.ok,
      },
    })
  } catch (e) {
    console.warn('LlmCall log failed:', e instanceof Error ? e.message : e)
  }
}

/** Usage for the Settings panel: today's tokens + this month per route. */
export async function llmUsage(userId: string): Promise<{
  todayTokens: number
  limit: number
  monthByRoute: Array<{ route: string; tokens: number }>
}> {
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  const [today, month] = await Promise.all([
    db.llmCall.aggregate({
      where: { userId, createdAt: { gte: dayStart } },
      _sum: { promptTokens: true, completionTokens: true },
    }),
    db.llmCall.groupBy({
      by: ['route'],
      where: { userId, createdAt: { gte: monthStart } },
      _sum: { promptTokens: true, completionTokens: true },
    }),
  ])
  const tokens = (r: { _sum: { promptTokens: number | null; completionTokens: number | null } }) =>
    (r._sum.promptTokens ?? 0) + (r._sum.completionTokens ?? 0)
  return {
    todayTokens: tokens(today),
    limit: budgetLimit(),
    monthByRoute: month
      .map((m) => ({ route: m.route, tokens: tokens(m) }))
      .sort((a, b) => b.tokens - a.tokens),
  }
}
