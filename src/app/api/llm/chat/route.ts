import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { LLM } from '@/lib/llm-server'

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

  let body: { system?: string; user?: string }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const system = String(body.system ?? '')
  const user = String(body.user ?? '')
  if (!system || !user) return jsonError(400, 'system and user are required')

  try {
    const text = await LLM.chat(me.id, system, user)
    return Response.json({ text })
  } catch (err) {
    console.error('llm/chat error:', err)
    const raw = err instanceof Error ? err.message : String(err)
    const safe = raw
      .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
      .replace(/api[_-]?key[:=]\s*\S+/gi, 'apiKey=***')
    return jsonError(500, `LLM call failed: ${safe}`)
  }
}
