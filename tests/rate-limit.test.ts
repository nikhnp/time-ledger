import { describe, it, expect, beforeAll } from 'vitest'
import { limit } from '@/lib/server/rate-limit'

describe('rate-limit (in-memory backend)', () => {
  it('allows up to max events in the window, then blocks', async () => {
    const key = `test-login-${Math.random()}`
    expect(await limit(key, 3, 60_000)).toBe(true)
    expect(await limit(key, 3, 60_000)).toBe(true)
    expect(await limit(key, 3, 60_000)).toBe(true)
    expect(await limit(key, 3, 60_000)).toBe(false) // 4th inside window
    expect(await limit(key, 3, 60_000)).toBe(false)
  })

  it('keys are isolated — one bucket never blocks another', async () => {
    const a = `test-iso-a-${Math.random()}`
    const b = `test-iso-b-${Math.random()}`
    expect(await limit(a, 1, 60_000)).toBe(true)
    expect(await limit(a, 1, 60_000)).toBe(false)
    expect(await limit(b, 1, 60_000)).toBe(true)
  })

  it('windows reset after expiry', async () => {
    const key = `test-window-${Math.random()}`
    expect(await limit(key, 1, 50)).toBe(true)
    expect(await limit(key, 1, 50)).toBe(false)
    await new Promise((r) => setTimeout(r, 70))
    expect(await limit(key, 1, 50)).toBe(true)
  })
})
