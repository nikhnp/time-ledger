import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import {
  findUserLlmSettings,
  createLlmSetting,
  updateLlmSetting,
  deleteLlmSetting,
  maskApiKey,
  maskStoredApiKey,
} from '@/lib/neon-sql'
import { generateId } from '@/lib/server/cuid'
import type { LlmConfigClientT } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** GET /api/settings/llm/me — list the current user's LLM settings. */
export async function GET(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  const rows = await findUserLlmSettings(me.id)
  const out: LlmConfigClientT[] = rows.map((r) => ({
    id: r.id,
    priority: r.priority,
    provider: r.provider,
    model: r.model,
    apiKeyMasked: maskStoredApiKey(r.apiKey),
    baseUrl: r.baseUrl,
    enabled: r.enabled,
    isSystem: false,
  }))
  return Response.json({ settings: out })
}

/** POST /api/settings/llm/me — add a new per-user LLM setting. */
export async function POST(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  let body: {
    provider?: string
    model?: string
    apiKey?: string
    baseUrl?: string | null
    enabled?: boolean
    priority?: number
  }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const provider = String(body.provider ?? '').trim()
  const model = String(body.model ?? '').trim()
  const apiKey = String(body.apiKey ?? '').trim()
  if (!provider) return jsonError(400, 'provider is required')
  if (!model) return jsonError(400, 'model is required')
  if (!apiKey) return jsonError(400, 'apiKey is required')

  const VALID_PROVIDERS = ['gemini', 'groq', 'openai', 'cerebras', 'openrouter', 'custom']
  if (!VALID_PROVIDERS.includes(provider)) return jsonError(400, `provider must be one of: ${VALID_PROVIDERS.join(', ')}`)
  if (provider === 'custom' && !body.baseUrl) return jsonError(400, 'baseUrl required for custom provider')

  const existing = await findUserLlmSettings(me.id)
  const priority = body.priority ?? existing.length

  const row = await createLlmSetting({
    id: generateId(),
    userId: me.id,
    priority,
    provider,
    model,
    apiKey,
    baseUrl: body.baseUrl ?? null,
    enabled: body.enabled ?? true,
  })

  return Response.json({
    setting: {
      id: row.id,
      priority: row.priority,
      provider: row.provider,
      model: row.model,
      apiKeyMasked: maskApiKey(apiKey),
      baseUrl: row.baseUrl,
      enabled: row.enabled,
      isSystem: false,
    } as LlmConfigClientT,
  })
}

export async function PATCH(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return jsonError(400, '?id= is required')

  let body: {
    provider?: string
    model?: string
    apiKey?: string
    baseUrl?: string | null
    enabled?: boolean
    priority?: number
  }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  // Make sure this setting belongs to the current user
  const existing = await findUserLlmSettings(me.id)
  if (!existing.find((s) => s.id === id)) return jsonError(404, 'setting not found')

  await updateLlmSetting(id, {
    provider: body.provider,
    model: body.model,
    apiKey: body.apiKey,
    baseUrl: body.baseUrl,
    enabled: body.enabled,
    priority: body.priority,
  })
  return Response.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return jsonError(400, '?id= is required')

  const existing = await findUserLlmSettings(me.id)
  if (!existing.find((s) => s.id === id)) return jsonError(404, 'setting not found')

  await deleteLlmSetting(id)
  return Response.json({ ok: true })
}
