import { resolveLlmChain } from '@/lib/neon-sql'
import { db } from '@/lib/db'
import { z } from 'zod'

/**
 * Server-side LLM client.
 *
 * v10 changes from src/lib/llm.ts:
 *   - No longer reads from localStorage (which doesn't exist on the server).
 *   - Fetches the LLM fallback chain from the DB: user's settings first,
 *     then system-wide settings.
 *   - Tries each in order until one succeeds.
 *
 * P3-2: structured output + cost control.
 *   - generateJson<T>(): provider-native structured output (OpenAI-compatible
 *     response_format json_schema / Gemini responseSchema) with a zod
 *     contract, one repair round, an 8s timeout, and a circuit breaker
 *     (3 consecutive provider failures → skip it for 5 minutes).
 *   - Every call logs an LlmCall row (even failures) and honours the
 *     per-user daily token budget (LLM_DAILY_TOKEN_BUDGET, default 50k).
 *
 * This is the server-side counterpart of src/lib/llm.ts (which is the
 * client-side BYO-key version). Both share the same provider definitions.
 */

export interface LLMChainEntry {
  id: string
  priority: number
  provider: string
  model: string
  apiKey: string // plaintext
  baseUrl: string | null
  source: 'user' | 'system'
}

/* ---------- P3-2: circuit breaker + budget ---------- */

const BREAKER_THRESHOLD = 3
const BREAKER_COOLDOWN_MS = 5 * 60 * 1000
const breakerState = new Map<string, { fails: number; openUntil: number }>()

function breakerAllows(key: string): boolean {
  const s = breakerState.get(key)
  if (!s) return true
  if (s.openUntil && Date.now() >= s.openUntil) {
    breakerState.delete(key)
    return true
  }
  return !s.openUntil
}

function breakerRecord(key: string, ok: boolean): void {
  const s = breakerState.get(key) ?? { fails: 0, openUntil: 0 }
  if (ok) {
    breakerState.delete(key)
    return
  }
  s.fails += 1
  if (s.fails >= BREAKER_THRESHOLD) {
    s.openUntil = Date.now() + BREAKER_COOLDOWN_MS
    s.fails = 0
  }
  breakerState.set(key, s)
}

const FETCH_TIMEOUT_MS = 8_000

function budgetLimit(): number {
  const n = Number(process.env.LLM_DAILY_TOKEN_BUDGET)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 50_000
}

async function tokensUsedToday(userId: string): Promise<number> {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const agg = await db.llmCall.aggregate({
    where: { userId, createdAt: { gte: start } },
    _sum: { promptTokens: true, completionTokens: true },
  })
  return (agg._sum.promptTokens ?? 0) + (agg._sum.completionTokens ?? 0)
}

async function logLlmCall(row: {
  userId: string | null
  route: string
  provider: string
  model: string
  promptTokens?: number
  completionTokens?: number
  latencyMs?: number
  ok?: boolean
}): Promise<void> {
  try {
    await db.llmCall.create({ data: { ...row } })
  } catch (e) {
    console.warn('LlmCall log failed:', e instanceof Error ? e.message : e)
  }
}

/* rough text→token estimate for providers that don't return usage
 * (~4 chars/token; the budget is a brake, not an invoice) */
const estTokens = (s: string): number => Math.ceil((s?.length ?? 0) / 4)

export const LLM_PROVIDERS: Record<string, { label: string; defaultModel: string; url: string }> = {
  gemini: { label: 'Google AI Studio (Gemini)', defaultModel: 'gemini-2.5-flash', url: 'https://generativelanguage.googleapis.com/v1beta/models' },
  groq: { label: 'Groq', defaultModel: 'llama-3.3-70b-versatile', url: 'https://api.groq.com/openai/v1/chat/completions' },
  openai: { label: 'OpenAI', defaultModel: 'gpt-4o-mini', url: 'https://api.openai.com/v1/chat/completions' },
  cerebras: { label: 'Cerebras', defaultModel: 'llama-3.3-70b', url: 'https://api.cerebras.ai/api/v1/chat/completions' },
  openrouter: { label: 'OpenRouter', defaultModel: 'meta-llama/llama-3.3-70b-instruct', url: 'https://openrouter.ai/api/v1/chat/completions' },
  custom: { label: 'Custom (OpenAI-compatible)', defaultModel: '', url: '' },
}

export const LLM = {
  /** Resolve the fallback chain for a user. */
  async resolveChain(userId: string): Promise<LLMChainEntry[]> {
    return await resolveLlmChain(userId)
  },

  /** Chat with the LLM, trying the fallback chain in order. */
  async chat(userId: string, system: string, user: string): Promise<string> {
    const chain = await this.resolveChain(userId)
    if (chain.length === 0) {
      throw new Error('No LLM configured. Ask an admin to set up a system-wide LLM, or add your own in Settings.')
    }

    let lastErr: Error | null = null
    for (const entry of chain) {
      try {
        return await this.chatWithEntry(entry, system, user)
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err))
        console.warn(`LLM provider ${entry.provider} (${entry.source}) failed:`, lastErr.message)
        // try next
      }
    }
    throw lastErr ?? new Error('All LLM providers failed')
  },

  async chatWithEntry(entry: LLMChainEntry, system: string, user: string): Promise<string> {
    const prov = LLM_PROVIDERS[entry.provider]
    if (!prov) throw new Error(`Unknown provider: ${entry.provider}`)
    const model = entry.model || prov.defaultModel
    if (!model) throw new Error(`No model configured for provider ${entry.provider}`)
    if (!entry.apiKey) throw new Error(`No API key for provider ${entry.provider}`)

    if (entry.provider === 'gemini') {
      const url = `${prov.url}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(entry.apiKey)}`
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1600 },
        }),
      })
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(`Gemini ${b.error?.message ?? `HTTP ${r.status}`}`)
      }
      const b = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
      const text = (b.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
      if (!text) throw new Error('Gemini returned an empty response')
      return text
    }

    /* OpenAI-compatible */
    const url = entry.provider === 'custom' ? `${(entry.baseUrl || '').replace(/\/+$/, '')}/chat/completions` : prov.url
    if (!/^https?:/i.test(url)) throw new Error('Custom base URL must start with http(s)://')
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${entry.apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.3,
        max_tokens: 1600,
      }),
    })
    if (!r.ok) {
      const b = (await r.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new Error(b.error?.message ?? `HTTP ${r.status}`)
    }
    const b = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const text = b.choices?.[0]?.message?.content
    if (!text) throw new Error(`Empty response from ${model}`)
    return text
  },

  /** P3-2: one provider call with provider-NATIVE structured output when a
   * JSON schema is given (OpenAI-compatible response_format / Gemini
   * responseMimeType+responseSchema). Providers that reject the parameter
   * degrade to prompt-instructed JSON (the schema is in the system prompt
   * too — never parse-and-pray: generateJson's zod parse is the contract). */
  async callEntry(
    entry: LLMChainEntry,
    system: string,
    user: string,
    opts: { jsonSchema?: Record<string, unknown>; maxTokens?: number; route: string },
  ): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
    const prov = LLM_PROVIDERS[entry.provider]
    if (!prov) throw new Error(`Unknown provider: ${entry.provider}`)
    const model = entry.model || prov.defaultModel
    if (!model) throw new Error(`No model configured for provider ${entry.provider}`)
    if (!entry.apiKey) throw new Error(`No API key for provider ${entry.provider}`)
    const maxTokens = opts.maxTokens ?? 1600

    if (entry.provider === 'gemini') {
      const url = `${prov.url}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(entry.apiKey)}`
      const body: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: maxTokens,
          ...(opts.jsonSchema
            ? { responseMimeType: 'application/json', responseSchema: opts.jsonSchema }
            : {}),
        },
      }
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(`Gemini ${b.error?.message ?? `HTTP ${r.status}`}`)
      }
      const b = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }
      const text = (b.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
      if (!text) throw new Error('Gemini returned an empty response')
      return {
        text,
        promptTokens: b.usageMetadata?.promptTokenCount ?? estTokens(system + user),
        completionTokens: b.usageMetadata?.candidatesTokenCount ?? estTokens(text),
      }
    }

    /* OpenAI-compatible */
    const url = entry.provider === 'custom' ? `${(entry.baseUrl || '').replace(/\/+$/, '')}/chat/completions` : prov.url
    if (!/^https?:/i.test(url)) throw new Error('Custom base URL must start with http(s)://')
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      max_tokens: maxTokens,
      ...(opts.jsonSchema
        ? { response_format: { type: 'json_schema', json_schema: { name: opts.route.replace(/[^a-z]/gi, '_') || 'output', strict: false, schema: opts.jsonSchema } } }
        : {}),
    }
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${entry.apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      body: JSON.stringify(body),
    })
    if (!r.ok) {
      const b = (await r.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new Error(b.error?.message ?? `HTTP ${r.status}`)
    }
    const b = (await r.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    const text = b.choices?.[0]?.message?.content
    if (!text) throw new Error(`Empty response from ${model}`)
    return {
      text,
      promptTokens: b.usage?.prompt_tokens ?? estTokens(system + user),
      completionTokens: b.usage?.completion_tokens ?? estTokens(text),
    }
  },

  async chatJSON<T>(userId: string, system: string, user: string): Promise<T> {
    const raw = await this.chat(userId, system, user)
    let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    const a = s.indexOf('{'), b = s.lastIndexOf('}')
    const a2 = s.indexOf('['), b2 = s.lastIndexOf(']')
    let pick: string | null = null
    if (a >= 0 && b > a) pick = s.slice(a, b + 1)
    if (a2 >= 0 && b2 > a2 && (a < 0 || a2 < a)) pick = s.slice(a2, b2 + 1)
    if (!pick) throw new Error(`The model replied without JSON: ${s.slice(0, 120)}`)
    return JSON.parse(pick) as T
  },

  /* ---------- P3-2: structured output + cost control ---------- */

  /**
   * The ONE entry point for LLM JSON. Provider-native schema when possible,
   * strict zod validation always, one repair round on invalid output,
   * 8s timeout, circuit breaker on the chain, and the per-user daily token
   * budget. Malformed model output can never crash a route: the caller
   * gets { error } and renders its static fallback.
   */
  async generateJson<T>(opts: {
    userId: string
    route: string // 'suggestions' | 'recommendations' | 'chat' | …
    schema: z.ZodType<T>
    system: string
    user: string
    maxTokens?: number
  }): Promise<
    | { data: T; source: 'schema' | 'json-mode' | 'repaired'; model: string; promptTokens: number; completionTokens: number }
    | { error: 'no-chain' | 'budget' | 'invalid' }
  > {
    const chain = await this.resolveChain(opts.userId)
    if (chain.length === 0) return { error: 'no-chain' }

    /* budget gate — friendly 429 upstream, static fallback downstream */
    try {
      const used = await tokensUsedToday(opts.userId)
      if (used >= budgetLimit()) return { error: 'budget' }
    } catch {
      /* budget check failure must not block the call */
    }

    /* zod 4 exports schemas to JSON Schema natively — the SAME schema
     * constrains the provider AND validates the answer. */
    let jsonSchema: Record<string, unknown> | undefined
    try {
      jsonSchema = z.toJSONSchema(opts.schema, { target: 'draft-7' }) as Record<string, unknown>
    } catch {
      jsonSchema = undefined // exotic schema — fall back to json-mode
    }
    const schemaHint = jsonSchema ? `\n\nOutput JSON matching exactly this shape: ${JSON.stringify(jsonSchema)}` : ''

    for (const entry of chain) {
      const key = `${entry.provider}:${entry.model}:${entry.source}`
      if (!breakerAllows(key)) continue
      const t0 = Date.now()
      try {
        const attempt = async (repairNote?: string) => {
          const u = repairNote ? `${opts.user}\n\nYour previous reply was invalid: ${repairNote}. Reply again with ONLY corrected JSON.` : opts.user
          return this.callEntry(entry, opts.system + schemaHint, u, { jsonSchema, maxTokens: opts.maxTokens, route: opts.route })
        }

        let res = await attempt()
        const parseOut = (): T | null => {
          try {
            return opts.schema.parse(extractJson(res.text))
          } catch {
            return null
          }
        }
        let data = parseOut()
        let source: 'schema' | 'json-mode' | 'repaired' = jsonSchema ? 'schema' : 'json-mode'
        if (!data) {
          // one repair round: append the validator error, retry
          res = await attempt(extractJson(res.text) === null ? 'it was not parseable JSON' : 'it violated the JSON schema')
          data = parseOut()
          source = 'repaired'
        }
        breakerRecord(key, true)
        void logLlmCall({
          userId: opts.userId,
          route: opts.route,
          provider: entry.provider,
          model: entry.model || LLM_PROVIDERS[entry.provider]?.defaultModel || '',
          promptTokens: res.promptTokens,
          completionTokens: res.completionTokens,
          latencyMs: Date.now() - t0,
          ok: !!data,
        })
        if (!data) return { error: 'invalid' }
        return { data, source, model: entry.model || LLM_PROVIDERS[entry.provider]?.defaultModel || '', promptTokens: res.promptTokens, completionTokens: res.completionTokens }
      } catch (err) {
        breakerRecord(key, false)
        void logLlmCall({
          userId: opts.userId,
          route: opts.route,
          provider: entry.provider,
          model: entry.model || LLM_PROVIDERS[entry.provider]?.defaultModel || '',
          latencyMs: Date.now() - t0,
          ok: false,
        })
        console.warn(`LLM ${opts.route} via ${entry.provider} failed:`, err instanceof Error ? err.message : err)
        // try the next provider in the chain
      }
    }
    return { error: 'invalid' }
  },
}

/** Pull the first JSON object/array out of a model reply (fence-stripping,
 * brace-matching — the pre-validation extraction only). */
function extractJson(raw: string): unknown {
  const s = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  const a2 = s.indexOf('[')
  const b2 = s.lastIndexOf(']')
  let pick: string | null = null
  if (a >= 0 && b > a) pick = s.slice(a, b + 1)
  if (a2 >= 0 && b2 > a2 && (a < 0 || a2 < a)) pick = s.slice(a2, b2 + 1)
  if (!pick) return null
  try {
    return JSON.parse(pick)
  } catch {
    return null
  }
}
