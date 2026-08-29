import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { LLM } from '@/lib/llm-server'
import { llmBudgetStatus, logClientLlmCall } from '@/lib/server/llm-ops'

export const dynamic = 'force-dynamic'

/**
 * POST /api/llm/chat
 * Body: { system: string, user: string }
 *
 * Server-side chat endpoint. Uses the resolved LLM fallback chain for the
 * current user (their settings first, then system-wide).
 *
 * Tries each provider in priority order until one succeeds. Returns 500
 * with a helpful message if all fail.
 */
export async function POST(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  let body: { system?: string; user?: string; route?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const system = String(body.system ?? '')
  const user = String(body.user ?? '')
  if (!system || !user) return jsonError(400, 'system and user are required')
  const route = String(body.route ?? 'chat').slice(0, 40)

  /* P3-2: the per-user daily token budget gates client-driven calls too —
   * budget exceeded → friendly 429, the UI toasts "back tomorrow". */
  const budget = await llmBudgetStatus(me.id)
  if (budget.exceeded) {
    return Response.json(
      { error: 'Daily AI budget reached — back tomorrow.' },
      { status: 429 },
    )
  }

  const t0 = Date.now()
  try {
    const text = await LLM.chat(me.id, system, user)
    await logClientLlmCall({ userId: me.id, route, ok: true, latencyMs: Date.now() - t0, promptChars: system.length + user.length, completionChars: text.length })
    return Response.json({ text })
  } catch (err) {
    console.error('llm/chat error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    const safe = raw
      .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
      .replace(/api[_-]?key[:=]\s*\S+/gi, 'apiKey=***')
    await logClientLlmCall({ userId: me.id, route, ok: false, latencyMs: Date.now() - t0, promptChars: system.length + user.length, completionChars: 0 })
    return jsonError(500, `LLM call failed: ${safe}`)
  }
}
