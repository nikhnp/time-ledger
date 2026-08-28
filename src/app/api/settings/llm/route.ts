import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import {
  findSystemLlmSettings,
  findUserLlmSettings,
  createLlmSetting,
  updateLlmSetting,
  deleteLlmSetting,
  maskApiKey,
} from '@/lib/neon-sql'
import { generateId } from '@/lib/server/cuid'
import type { LlmConfigClientT } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** GET /api/settings/llm — list system-wide LLM settings (admin only). */
export async function GET(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')
  if (me.role !== 'admin') return jsonError(403, 'admins only')

  const rows = await findSystemLlmSettings()
  const out: LlmConfigClientT[] = rows.map((r) => ({
    id: r.id,
    priority: r.priority,
    provider: r.provider,
    model: r.model,
    apiKeyMasked: maskApiKey(decrypt(r.apiKey)),
    baseUrl: r.baseUrl,
    enabled: r.enabled,
    isSystem: true,
  }))
  return Response.json({ settings: out })
}

/** POST /api/settings/llm — add a new system-wide LLM setting (admin only). */
export async function POST(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')
  if (me.role !== 'admin') return jsonError(403, 'admins only')

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

  // Basic provider validation
  const VALID_PROVIDERS = ['gemini', 'groq', 'openai', 'cerebras', 'openrouter', 'custom']
  if (!VALID_PROVIDERS.includes(provider)) return jsonError(400, `provider must be one of: ${VALID_PROVIDERS.join(', ')}`)
  if (provider === 'custom' && !body.baseUrl) return jsonError(400, 'baseUrl required for custom provider')

  const existing = await findSystemLlmSettings()
  const priority = body.priority ?? existing.length

  const row = await createLlmSetting({
    id: generateId(),
    userId: null,
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
      isSystem: true,
    } as LlmConfigClientT,
  })
}

/** PATCH /api/settings/llim?id=... — update a setting. */
export async function PATCH(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')
  if (me.role !== 'admin') return jsonError(403, 'admins only')

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

/** DELETE /api/settings/llm?id=... — remove a setting. */
export async function DELETE(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')
  if (me.role !== 'admin') return jsonError(403, 'admins only')

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return jsonError(400, '?id= is required')
  await deleteLlmSetting(id)
  return Response.json({ ok: true })
}

/** Test endpoint: GET /api/settings/llm/test — runs a test prompt against the resolved chain. */
export async function PUT(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  // Delegate to LLM library (lazy import to avoid circular)
  const { LLM } = await import('@/lib/llm-server')
  const chain = await LLM.resolveChain(me.id)
  if (chain.length === 0) return jsonError(400, 'No LLM configured — ask an admin to set one up, or add your own in Settings.')

  try {
    const t0 = Date.now()
    await LLM.chat(me.id, 'Reply with the single word: ok', 'ping')
    return Response.json({ ok: true, ms: Date.now() - t0, source: 'test' })
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    return jsonError(500, `LLM test failed: ${raw}`)
  }
}

// Decrypt helper — kept inline since neon-sql doesn't export it
function decrypt(cipherB64: string): string {
  try {
    const buf = Buffer.from(cipherB64, 'base64')
    const keyBuf = Buffer.from(process.env.LLM_KEY_OBFUSCATION_SECRET ?? 'ledger-v10-default-obfuscation-key', 'utf8')
    for (let i = 0; i < buf.length; i++) buf[i] ^= keyBuf[i % keyBuf.length]
    return buf.toString('utf8')
  } catch {
    return ''
  }
}
