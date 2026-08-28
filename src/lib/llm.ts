'use client'
/* LLM client — v10.
 *
 * v10 architecture change:
 *   LLM credentials now live in the DATABASE (via /api/settings/llm/* routes).
 *   - System-wide settings are configured by admins and fall back to per-user.
 *   - Per-user settings are configured by each user in their Settings panel.
 *
 * To preserve the existing client-side call patterns (LLM.chat(), LLM.chatJSON(),
 * etc.), this file now proxies chat requests through the new server-side
 * endpoint /api/llm/chat. The server resolves the fallback chain and tries
 * providers in order until one succeeds.
 *
 * For backward compatibility with the prototype's localStorage-based approach,
 * we still load LLMConfig from localStorage as a fallback. But the primary
 * path is the server.
 */

import type { Ledger, MergeDelta } from './types'
import { todayStr } from './dates'

export interface LLMConfig {
  provider: string
  model: string
  apiKey: string
  baseUrl: string
}

export const LLM_PROVIDERS: Record<string, { label: string; model: string; url: string }> = {
  gemini: { label: 'Google AI Studio (Gemini)', model: 'gemini-2.5-flash', url: 'https://generativelanguage.googleapis.com/v1beta/models' },
  groq: { label: 'Groq', model: 'llama-3.3-70b-versatile', url: 'https://api.groq.com/openai/v1/chat/completions' },
  openai: { label: 'OpenAI', model: 'gpt-4o-mini', url: 'https://api.openai.com/v1/chat/completions' },
  cerebras: { label: 'Cerebras', model: 'llama-3.3-70b', url: 'https://api.cerebras.ai/api/v1/chat/completions' },
  openrouter: { label: 'OpenRouter', model: 'meta-llama/llama-3.3-70b-instruct', url: 'https://openrouter.ai/api/v1/chat/completions' },
  custom: { label: 'Custom (OpenAI-compatible)', model: '', url: '' },
}

const LS_KEY = 'ledger_llm' // legacy — kept for backward compat

export const LLM = {
  cfg(): LLMConfig {
    try {
      const c = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null') as LLMConfig | null
      if (c && c.provider) return c
    } catch { /* ignore */ }
    return { provider: '', model: '', apiKey: '', baseUrl: '' }
  },
  saveCfg(c: LLMConfig) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(c)) } catch { /* ignore */ }
  },
  configured(): boolean {
    // In v10, we trust the server's fallback chain. If the user has saved
    // their own config in localStorage, that counts too.
    return !!this.cfg().provider || true // always returns true — server will throw if no chain available
  },
  modelLabel(): string {
    const c = this.cfg()
    return c.model || LLM_PROVIDERS[c.provider]?.model || 'configured via server'
  },

  err(msg: string, e?: unknown): string {
    let m = msg
    if (e instanceof Error && e.message) m += ` — ${e.message}`
    if (/Failed to fetch|NetworkError|load failed/i.test(m)) {
      m += ' (network/CORS: check the key, the model name, and that the provider allows browser requests)'
    }
    return m
  },

  /** v10: chat via the server endpoint (uses DB-stored fallback chain). */
  async chat(system: string, user: string): Promise<string> {
    const r = await fetch('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, user }),
    })
    if (!r.ok) {
      const b = (await r.json().catch(() => ({}))) as { error?: string }
      throw new Error(b.error ?? `HTTP ${r.status}`)
    }
    const b = (await r.json()) as { text: string }
    return b.text
  },

  async chatJSON<T>(system: string, user: string): Promise<T> {
    const raw = await this.chat(system, user)
    let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    const a = s.indexOf('{'), b = s.lastIndexOf('}')
    const a2 = s.indexOf('['), b2 = s.lastIndexOf(']')
    let pick: string | null = null
    if (a >= 0 && b > a) pick = s.slice(a, b + 1)
    if (a2 >= 0 && b2 > a2 && (a < 0 || a2 < a)) pick = s.slice(a2, b2 + 1)
    if (!pick) throw new Error(`The model replied without JSON: ${s.slice(0, 120)}`)
    return JSON.parse(pick) as T
  },

  async test(): Promise<number> {
    const t0 = Date.now()
    await this.chat('Reply with the single word: ok', 'ping')
    return Date.now() - t0
  },

  /* ---------- job 1: day → delta ---------- */
  async structureDay(text: string, ledger: Ledger): Promise<Record<string, unknown>> {
    const ctx =
      `The ledger knows:\n` +
      `- goals (use exactly these goalId values): ${ledger.goals.map((g) => `${g.id} = "${g.name}"`).join(', ')}\n` +
      `- habits (use exactly these habitId values): ${ledger.habits.map((h) => `${h.id} = "${h.name}"`).join(', ')}\n` +
      `- metrics: ${ledger.metrics.map((m) => `${m.id} = "${m.name}" (${m.unit})`).join(', ') || '(none)'}`
    const system =
      'You are the structuring engine of Ledger, a personal time-tracking app. Turn what the person says about their day into a strict JSON delta. Output ONLY the JSON object — no prose, no markdown fences.\n\n' +
      ctx + '\n\n' +
      'JSON shape:\n' +
      '{"date":"YYYY-MM-DD","highlight":"one short line","checkIn":{"question":"...","answer":"..."},' +
      '"activities":[{"goalId":"...","label":"short label","hours":1.5,"start":"HH:MM","end":"HH:MM"}],' +
      '"habits":[{"habitId":"...","done":true}],"metrics":[{"metricId":"...","value":2.5}],"newNotes":["..."]}\n\n' +
      'Rules:\n' +
      `- Today is ${todayStr()}. Use it unless another date is clearly stated.\n` +
      '- Convert spoken times to 24h HH:MM ("nine to half past twelve" = 09:00 to 12:30). hours must equal end minus start.\n' +
      '- No times given? Omit start/end and give hours. Rough duration ("for a while") = 1 hour.\n' +
      '- Only include what was actually said. Never invent goalIds or habitIds.\n' +
      '- Reminders, deadlines, ideas, promises -> newNotes as plain sentences.\n' +
      '- highlight: one short line about what mattered. checkIn only if the person reflected on the day.'
    return this.chatJSON<Record<string, unknown>>(system, text)
  },

  /* ---------- job 2: note → date ---------- */
  async extractDate(noteText: string): Promise<{ date: string; label: string; type: string } | null> {
    const system =
      `Today is ${todayStr()}. From the note below, extract a date if one is stated or clearly implied (resolve "Friday", "end of next week", "the 28th", "before the trip" style language). ` +
      'Output ONLY {"date":"YYYY-MM-DD","label":"short label, max 5 words","type":"deadline|birthday|reminder|event"} or {} if no date is determinable. No prose.'
    const obj = await this.chatJSON<{ date?: string; label?: string; type?: string }>(system, `Note: "${noteText.slice(0, 400)}"`)
    if (!obj || !obj.date || !/^\d{4}-\d{2}-\d{2}$/.test(obj.date)) return null
    return {
      date: obj.date,
      label: String(obj.label ?? noteText).slice(0, 60),
      type: ['deadline', 'birthday', 'reminder', 'event'].includes(String(obj.type)) ? String(obj.type) : 'event',
    }
  },

  /* ---------- job 3: wrapped words ---------- */
  async writeWords(period: string, highlights: string[], stats: string): Promise<string> {
    const system =
      'You write the margin notes of a personal paper ledger — warm, observant, a little blunt. Never preachy, no emoji, no lists. 2 to 3 sentences, plain text only.\n' +
      'Speak to the person directly ("you"), reference specific days or moments from the highlights, and end with one pointed question or push.'
    const user =
      `Write the ${period} summary.\n` +
      'Highlights from the days (oldest first):\n' +
      (highlights.length ? highlights.map((h) => `- "${h}"`).join('\n') : '- (none written)') + '\n' +
      `Stats: ${stats}\nIf there is nothing at all, write one gentle sentence about the blank page.`
    return (await this.chat(system, user)).trim()
  },
}

export type { MergeDelta }
