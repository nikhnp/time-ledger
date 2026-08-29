/* P2-3: validation rules shared between the merge pipeline and the
 * PATCH routes. Extracted from applyMergeDelta so an edit can never accept
 * what a capture would reject (and vice versa). */

import { validTimeStr } from '@/lib/dates'

export interface NormalizedTimes {
  hours: number
  start: string | null
  end: string | null
}

/**
 * The exact rules from the merge pipeline: start/end → hours derivation,
 * the 0 < hours ≤ 24 clamp, "end before start" rejection. Pure.
 */
export function normalizeActivityTimes(input: {
  hours?: number | null
  start?: string | null
  end?: string | null
}): NormalizedTimes {
  let start = validTimeStr(input.start) ? input.start : null
  let end = validTimeStr(input.end) ? input.end : null
  let hours = Number(input.hours)
  if (start && end) {
    const mins =
      Number(end.slice(0, 2)) * 60 + Number(end.slice(3)) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)))
    if (mins <= 0) {
      end = null
    } else {
      hours = +(mins / 60).toFixed(2)
    }
  }
  if (!(hours > 0 && hours <= 24)) hours = hours > 0 ? Math.min(24, hours) : 0.5
  return { hours, start, end }
}

/** Label discipline: trim, drop empties, hard-cap length. */
export function cleanLabel(label: unknown, max = 80): string | null {
  if (typeof label !== 'string') return null
  const s = label.trim()
  return s ? s.slice(0, max) : null
}
