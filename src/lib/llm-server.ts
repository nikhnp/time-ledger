import { resolveLlmChain } from '@/lib/neon-sql'

/**
 * Server-side LLM client.
 *
 * v10 changes from src/lib/llm.ts:
 *   - No longer reads from localStorage (which doesn't exist on the server).
 *   - Fetches the LLM fallback chain from the DB: user's settings first,
 *     then system-wide settings.
 *   - Tries each in order until one succeeds.
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
}
