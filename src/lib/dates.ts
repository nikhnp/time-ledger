/* Date helpers — all "YYYY-MM-DD" strings, UTC-midnight discipline to match the server */

export function isoLocal(d: Date): string {
  return d.toISOString().slice(0, 10)
}
export function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
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
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(s2d(s).getTime())
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
