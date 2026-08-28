/* Date helpers — all "YYYY-MM-DD" strings, UTC-midnight discipline to match the server */

export function isoLocal(d: Date): string {
  return d.toISOString().slice(0, 10)
}
/**
 * "Today" as a YYYY-MM-DD string.
 * - Browser (client): resolves in the device's own zone (P1-5) — consistent
 *   with the server, which resolves per-user tz via todayIn(user.tz).
 * - Server: UTC (callers that know the user's zone must use todayIn(tz)).
 */
export function todayStr(): string {
  if (typeof window !== 'undefined') return todayIn(clientTz())
  return new Date().toISOString().slice(0, 10)
}

/**
 * P1-5: resolve "today" in a user's timezone.
 *
 * v10.3 resolved every "today" as UTC, so in UTC+5:45 the day flipped at
 * 05:45 local — morning check-ins landed on yesterday. `todayIn(tz)` uses
 * Intl (dependency-free); 'en-CA' formats as YYYY-MM-DD directly.
 * Invalid/unknown zones fall back to UTC rather than throwing.
 */
export function todayIn(tz: string | null | undefined, now: Date = new Date()): string {
  if (!tz) return todayStr()
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)
  } catch {
    return todayStr()
  }
}

/** The client's own IANA zone — reported to the server at boot (P1-5). */
export function clientTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
export function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return isoLocal(d)
}
export function isoMonthOf(s: string): string {
  return s.slice(0, 7)
}
export function s2d(s: string): Date {
  return new Date(s + 'T00:00:00Z')
}
export function d2s(d: Date): string {
  return d.toISOString().slice(0, 10)
}
export function toMin(s: string): number {
  const p = s.split(':')
  return +p[0] * 60 + +p[1]
}
export function hm(h: number): string {
  let H = Math.floor(h + 1e-9)
  let M = Math.round((h - H) * 60)
  if (M === 60) { H++; M = 0 }
  return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`
}
export function hmDate(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
export function fmtDate(s: string): string {
  return s2d(s).toLocaleDateString(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' })
}
export function fmtDateShort(s: string): string {
  return s2d(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
export function daysUntil(s: string | null | undefined): number | null {
  if (!s) return null
  return Math.round((s2d(s).getTime() - s2d(todayStr()).getTime()) / 86400000)
}
export function daysSince(s: string): number {
  return Math.round((s2d(todayStr()).getTime() - s2d(s).getTime()) / 86400000)
}
export function validDateStr(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  // Round-trip check: V8's date parser silently rolls impossible dates
  // forward ('2026-02-30' → Mar 2, '2026-02-29' → Mar 1). Reject those —
  // a typo must never silently land on the wrong day.
  return d2s(s2d(s)) === s
}
export function validTimeStr(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}

/** Monday-aligned week containing today */
export function currentWeekDates(): string[] {
  const now = new Date()
  const day = now.getUTCDay()
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((day + 6) % 7)))
  return Array.from({ length: 7 }, (_, i) => d2s(new Date(monday.getTime() + i * 86400000)))
}

export function fmtRange(s: Date, e: Date): string {
  const f = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${f(s)} – ${f(e)}`
}

export function uid(p: string): string {
  return p + Date.now().toString(36) + Math.floor(Math.random() * 999)
}
