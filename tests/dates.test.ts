import { describe, it, expect } from 'vitest'
import { todayIn, isoLocal, s2d, d2s, validDateStr } from '@/lib/dates'

/**
 * P1-5: "today" must resolve in the USER's timezone, not UTC.
 * Kathmandu = UTC+5:45 — the sharpest non-hour offset in the test set.
 */
describe('todayIn (timezone-correct today)', () => {
  // 2026-08-28 18:30 UTC
  const evening = new Date('2026-08-28T18:30:00Z')

  it('is UTC-safe (null/undefined tz → UTC today)', () => {
    expect(todayIn(null, evening)).toBe('2026-08-28')
    expect(todayIn(undefined, evening)).toBe('2026-08-28')
    expect(todayIn('UTC', evening)).toBe('2026-08-28')
  })

  it('rolls forward near midnight in positive offsets (Kathmandu +5:45)', () => {
    // 18:30 UTC = 00:15 next day in Kathmandu
    expect(todayIn('Asia/Kathmandu', evening)).toBe('2026-08-29')
  })

  it('rolls back in negative offsets (Los Angeles -7 in August)', () => {
    expect(todayIn('America/Los_Angeles', evening)).toBe('2026-08-28')
    // 2026-08-28 06:00 UTC = 23:00 Aug 27 in LA
    expect(todayIn('America/Los_Angeles', new Date('2026-08-28T06:00:00Z'))).toBe('2026-08-27')
  })

  it('falls back to UTC for invalid zones instead of throwing', () => {
    expect(todayIn('Not/AZone', evening)).toBe('2026-08-28')
  })

  it('handles DST boundaries (New York crosses DST in November)', () => {
    // 2026-11-01 04:30 UTC = 00:30 EDT (UTC-4) same day in NY
    expect(todayIn('America/New_York', new Date('2026-11-01T04:30:00Z'))).toBe('2026-11-01')
  })
})

describe('date helpers (unchanged behavior, pinned by tests)', () => {
  it('s2d/d2s round-trip UTC-midnight discipline (incl. leap day)', () => {
    expect(d2s(s2d('2024-02-29'))).toBe('2024-02-29') // 2024 is a leap year
    expect(d2s(s2d('2026-08-28'))).toBe('2026-08-28')
  })

  it('validDateStr rejects garbage', () => {
    expect(validDateStr('2026-02-30')).toBe(false) // Feb 30 doesn't exist
    expect(validDateStr('2026-2-3')).toBe(false)
    expect(validDateStr('nonsense')).toBe(false)
    expect(validDateStr('2026-08-28')).toBe(true)
  })

  it('isoLocal formats a UTC-midnight date', () => {
    expect(isoLocal(s2d('2026-08-28'))).toBe('2026-08-28')
  })
})
