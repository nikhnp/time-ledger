import { describe, it, expect } from 'vitest'
import { parseDateWords } from '@/lib/date-words'

/**
 * P2-9: the rule-based relative-date parser — the no-LLM floor for
 * "deadline after exactly a week" landing on THAT day. Pure functions,
 * always-on tests (no DB).
 *
 * `today` is pinned so relative resolutions are deterministic; in the app
 * it comes from todayIn(user.tz) — never UTC's clock.
 */
describe('parseDateWords (P2-9)', () => {
  const today = '2026-08-29' // a Saturday

  it('resolves "after exactly a week" to +7 days', () => {
    const out = parseDateWords('I have a deadline after exactly a week', today)
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-09-05')
    expect(out[0].type).toBe('deadline')
  })

  it('resolves "in 3 days" / "in two weeks"', () => {
    expect(parseDateWords('submit the form in 3 days', today)[0]?.date).toBe('2026-09-01')
    expect(parseDateWords('presentation in two weeks', today)[0]?.date).toBe('2026-09-12')
  })

  it('resolves "next monday" to the coming monday', () => {
    const out = parseDateWords('dentist appointment next monday', today)
    expect(out[0].date).toBe('2026-08-31')
    expect(out[0].type).toBe('event')
  })

  it('never captures a bare weekday without intent ("did laundry on monday")', () => {
    expect(parseDateWords('I did laundry on monday and forgot the toast', today)).toHaveLength(0)
  })

  it('captures "on friday" when the sentence carries intent', () => {
    const out = parseDateWords('deadline on friday for the report', today)
    expect(out[0]?.date).toBe('2026-09-04') // the NEXT friday, not today
  })

  it('resolves "tomorrow" and "day after tomorrow"', () => {
    expect(parseDateWords('renew the lease tomorrow', today)[0]?.date).toBe('2026-08-30')
    expect(parseDateWords('return the router the day after tomorrow', today)[0]?.date).toBe('2026-08-31')
  })

  it('resolves "end of the month" to the last day', () => {
    const out = parseDateWords('pay the bill by the end of the month', today)
    expect(out[0]?.date).toBe('2026-08-31')
    expect(out[0]?.type).toBe('deadline')
  })

  it('resolves "on the 15th" forward, rolling to next month when past', () => {
    expect(parseDateWords('exam on the 15th', '2026-09-01')[0]?.date).toBe('2026-09-15')
    expect(parseDateWords('exam on the 5th', '2026-09-10')[0]?.date).toBe('2026-10-05')
  })

  it('resolves ISO dates and month-day forms', () => {
    expect(parseDateWords('flight on 2026-09-10 to Kochi', today)[0]?.date).toBe('2026-09-10')
    expect(parseDateWords('birthday party Sep 4', today)[0]?.date).toBe('2026-09-04')
    expect(parseDateWords('birthday party Sep 4', today)[0]?.type).toBe('birthday')
  })

  it('labels derive from the sentence, capped at 80 chars', () => {
    const out = parseDateWords('I have a deadline after exactly a week for the quarterly report draft', today)
    expect(out[0].label.length).toBeLessThanOrEqual(80)
    expect(out[0].label.toLowerCase()).toContain('deadline')
  })

  it('never returns a past date and caps at 10 items', () => {
    const text = Array.from({ length: 14 }, (_, i) => `deadline in ${i + 1} days for item ${i}`).join('. ')
    const out = parseDateWords(text, today)
    expect(out.length).toBeLessThanOrEqual(10)
    out.forEach((r) => expect(r.date >= today).toBe(true))
  })

  it('produces nothing for empty or intent-free text', () => {
    expect(parseDateWords('', today)).toHaveLength(0)
    expect(parseDateWords('long day, lots of walking around', today)).toHaveLength(0)
  })
})
