/* P2-9: rule-based relative-date extraction — the no-LLM floor.
 *
 * "I have a deadline after exactly a week" must land on THAT day's Today /
 * Week / Month views — not as today's note. The LLM path resolves dates too,
 * but capture has to work offline-LLM as well, so this mini-parser runs on
 * the raw text before (or instead of) the model call and produces the same
 * `dates[]` delta block. Pure and dependency-free (`chrono`-style, minus the
 * dependency): top ~20 English relative-date patterns, resolved against the
 * USER's timezone date (`todayIn(tz)` — never UTC's clock).
 *
 * Conservative by design: a match counts only when the sentence it lives in
 * carries intent (deadline / due / remind / on the 15th / in 3 days …), so
 * "I did laundry on Monday" is never captured as a future item.
 */

export interface ParsedDate {
  label: string
  date: string // YYYY-MM-DD
  type: 'deadline' | 'birthday' | 'reminder' | 'event'
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function ymd(y: number, m: number, d: number): string {
  // m is 1-indexed; reject impossible dates by round-trip
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return ''
  return `${y}-${pad(m)}-${pad(d)}`
}
function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Split text into sentences (period, newline, semicolon, or "?" / "!"). */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const INTENT_RE =
  /\b(deadline|due|submit|hand\s*in|remind(?:er)?|appointment|meeting|exam|interview|renew|expires?|expiry|birthday|anniversary|pay|bill|file|book(?:ing)?|call|flight|train|visit|pickup|drop\s*off|return|deadline-ish)\b/i

function typeFor(sentence: string): ParsedDate['type'] {
  if (/\bbirthday|anniversary\b/i.test(sentence)) return 'birthday'
  if (/\bremind(?:er)?\b/i.test(sentence)) return 'reminder'
  if (/\bdeadline|due|submit|hand\s*in|renew|expires?|expiry|file|pay|bill|tax\b/i.test(sentence)) return 'deadline'
  return 'event'
}

/** Derive a short human label for the item from the sentence around the match. */
function labelFor(sentence: string): string {
  let s = sentence
    .replace(/^\s*(?:i\s+)?(?:have|need(?:\s+to)?|must|should|want\s+to|gotta|remember\s+to)\s+/i, '')
    .replace(/^\s*(?:i\s+)?(?:have\s+an?\s+|have\s+a\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:my|the|a|an)\s+/i, '')
  // strip trailing clauses that add nothing ("after exactly a week", "on friday")
  s = s.replace(/\s*\b(?:after exactly|exactly after|in|after|on|by|before|next|this|coming)\s+\S+\s*$/i, '').trim()
  if (!s) s = sentence
  s = s.charAt(0).toUpperCase() + s.slice(1)
  return s.length > 80 ? `${s.slice(0, 77)}…` : s
}

interface Rule {
  re: RegExp
  /** returns the resolved date, or '' to reject this match */
  resolve: (m: RegExpMatchArray, today: string) => string
}

const RULES: Rule[] = [
  // "after exactly a week", "exactly a week from now", "a week from today"
  {
    re: /\b(?:after\s+)?exactly\s+(a|an|one|two|three|four|\d+)\s+(day|week|month)s?(?:\s+(?:from\s+(?:now|today)|later|after))?\b/i,
    resolve: (m, today) => {
      const n = /^(a|an|one)$/i.test(m[1]) ? 1 : /^\btwo$/i.test(m[1]) ? 2 : /^\bthree$/i.test(m[1]) ? 3 : /^\bfour$/i.test(m[1]) ? 4 : Number(m[1])
      if (!Number.isFinite(n) || n <= 0 || n > 365) return ''
      const mult = m[2].toLowerCase() === 'week' ? 7 : m[2].toLowerCase() === 'month' ? 30 : 1
      return addDays(today, n * mult)
    },
  },
  // "in 3 days / in two weeks / in a month"
  {
    re: /\bin\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(day|week|month)s?\b/i,
    resolve: (m, today) => {
      const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
      const n = words[m[1].toLowerCase()] ?? Number(m[1])
      if (!Number.isFinite(n) || n <= 0 || n > 365) return ''
      const mult = m[2].toLowerCase() === 'week' ? 7 : m[2].toLowerCase() === 'month' ? 30 : 1
      return addDays(today, n * mult)
    },
  },
  // "a week from now/today", "two weeks out"
  {
    re: /\b(a|an|one|two|three|\d+)\s+(day|week|month)s?\s+(?:from\s+(?:now|today)|out)\b/i,
    resolve: (m, today) => {
      const n = /^(a|an|one)$/i.test(m[1]) ? 1 : Number(m[1])
      if (!Number.isFinite(n) || n <= 0) return ''
      const mult = m[2].toLowerCase() === 'week' ? 7 : m[2].toLowerCase() === 'month' ? 30 : 1
      return addDays(today, n * mult)
    },
  },
  // "next monday" (strictly after this week's same weekday), "this friday", "on friday", "coming saturday"
  {
    re: /\b(next|this|coming)?\s*(?:on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    resolve: (m, today) => {
      const target = WEEKDAYS.indexOf(m[2].toLowerCase() as (typeof WEEKDAYS)[number])
      const todayD = new Date(today + 'T00:00:00Z')
      const cur = todayD.getUTCDay()
      let diff = (target - cur + 7) % 7
      if (diff === 0) diff = 7 // "on friday" said on a friday → next friday, not today
      if (m[1] && /^next$/i.test(m[1]) && diff < 7) diff += 0 // base is already the next occurrence
      if (m[1] && /^next$/i.test(m[1])) diff += 0
      return addDays(today, diff)
    },
  },
  // "tomorrow", "day after tomorrow"
  {
    re: /\b(?:the\s+)?day\s+after\s+tomorrow\b|\btomorrow\b/i,
    resolve: (m, today) => addDays(today, /after/i.test(m[0]) ? 2 : 1),
  },
  // "next week" / "next month"
  {
    re: /\bnext\s+(week|month)\b/i,
    resolve: (m, today) => addDays(today, m[1].toLowerCase() === 'week' ? 7 : 30),
  },
  // "end of the week" (Sunday), "end of the month"
  {
    re: /\b(?:by\s+)?(?:the\s+)?end\s+of\s+(?:the\s+|this\s+)?(week|month)\b/i,
    resolve: (m, today) => {
      const d = new Date(today + 'T00:00:00Z')
      if (m[1].toLowerCase() === 'week') {
        const add = (7 - d.getUTCDay()) % 7 || 7 // upcoming Sunday (not today)
        return addDays(today, add)
      }
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
      return last.toISOString().slice(0, 10)
    },
  },
  // "on the 15th" / "the 28th" — day-of-month; past → next month
  {
    re: /\bon\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b|\bthe\s+(\d{1,2})(?:st|nd|rd|th)\s+of\s+(?:this\s+month)?/i,
    resolve: (m, today) => {
      const day = Number(m[1] ?? m[2])
      if (!(day >= 1 && day <= 31)) return ''
      const d = new Date(today + 'T00:00:00Z')
      let out = ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, day)
      if (!out || out < today) out = ymd(d.getUTCFullYear(), d.getUTCMonth() + 2, day) || ''
      return out
    },
  },
  // ISO "on 2026-09-04"
  {
    re: /\b(20\d{2})-(\d{2})-(\d{2})\b/,
    resolve: (m) => ymd(Number(m[1]), Number(m[2]), Number(m[3])),
  },
  // "Sep 4" / "September 4" / "4 Sep" / "4 September" (+ optional year)
  {
    re: /\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:\s*,?\s*(20\d{2}))?|(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s*,?\s*(20\d{2}))?)\b/i,
    resolve: (m, today) => {
      const monStr = (m[1] ?? m[5] ?? '').toLowerCase()
      const day = Number(m[2] ?? m[4])
      const year = Number(m[3] ?? m[6]) || new Date(today + 'T00:00:00Z').getUTCFullYear()
      const mon = MONTHS.indexOf(monStr as (typeof MONTHS)[number]) + 1
      if (!mon || !(day >= 1 && day <= 31)) return ''
      let out = ymd(year, mon, day)
      if (!out) return ''
      if (!m[3] && !m[6] && out < today) out = ymd(year + 1, mon, day) || ''
      return out
    },
  },
  // "in 3 days' time", "this weekend" (Saturday)
  {
    re: /\bthis\s+weekend\b/i,
    resolve: (_m, today) => {
      const cur = new Date(today + 'T00:00:00Z').getUTCDay()
      const diff = ((6 - cur) % 7) || 7 // upcoming Saturday
      return addDays(today, diff)
    },
  },
]

/**
 * Extract dated items from free text.
 * @param text   the capture text (spoken or typed)
 * @param today  the USER's local date (`todayIn(tz)`) — never UTC's
 */
export function parseDateWords(text: string, today: string): ParsedDate[] {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return []
  const out: ParsedDate[] = []
  const seen = new Set<string>()
  for (const sentence of sentences(text)) {
    const hasIntent = INTENT_RE.test(sentence)
    for (const rule of RULES) {
      const m = sentence.match(rule.re)
      if (!m) continue
      const date = rule.resolve(m, today)
      if (!date || date < today) continue // never land in the past
      // future dates need intent UNLESS the phrase itself is intent-y
      // ("in 3 days", "next monday" said alone) — require intent keywords
      // only for bare weekday/month-day mentions.
      const bareMention = /\b(?:on\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(m[0]) ||
        /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(m[0]) ||
        /\bthe\s+\d{1,2}(?:st|nd|rd|th)\b/i.test(m[0]) ||
        /\b20\d{2}-\d{2}-\d{2}\b/.test(m[0])
      if (bareMention && !hasIntent) continue
      const key = `${date}::${sentence.slice(0, 40).toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ label: labelFor(sentence), date, type: typeFor(sentence) })
      break // one date per sentence
    }
  }
  return out.slice(0, 10)
}
