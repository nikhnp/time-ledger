/**
 * Fixed-window rate limiting (P1-1d).
 *
 * Two backends behind one function:
 *  - default: in-memory Map, keyed per serverless-instance. Honest about its
 *    limits on Netlify (state does not share between lambdas) but still a
 *    real brake on credential stuffing from a single source.
 *  - opt-in: Upstash Redis REST (shared across instances) when
 *    UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set.
 *
 * Design: fail-open on backend errors (a limiter outage must never take the
 * login flow down), fixed windows (simple, no drift), atomic increments.
 */

interface LimitResult {
  ok: boolean
  remaining: number
  resetMs: number // ms until the window resets
}

const buckets = new Map<string, { count: number; windowStart: number }>()

// Lazy sweep so the Map cannot grow unbounded across warm invocations.
let lastSweep = 0
function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [k, v] of buckets) {
    // keep entries for at most one window past expiry
    if (now - v.windowStart > 2 * 3_600_000) buckets.delete(k)
  }
}

async function limitInMemory(key: string, max: number, windowMs: number): Promise<LimitResult> {
  const now = Date.now()
  sweep(now)
  const b = buckets.get(key)
  if (!b || now - b.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now })
    return { ok: true, remaining: max - 1, resetMs: windowMs }
  }
  b.count += 1
  const resetMs = windowMs - (now - b.windowStart)
  return { ok: b.count <= max, remaining: Math.max(0, max - b.count), resetMs }
}

async function limitUpstash(
  key: string,
  max: number,
  windowMs: number,
  url: string,
  token: string,
): Promise<LimitResult> {
  // Upstash REST pipeline: INCR + (on first hit) PEXPIRE.
  const rKey = `ratelimit:${key}`
  const r = await fetch(`${url.replace(/\/+$/, '')}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['INCR', rKey],
      ['PEXPIRE', rKey, String(windowMs)],
    ]),
  })
  if (!r.ok) throw new Error(`upstash http ${r.status}`)
  const out = (await r.json()) as Array<{ result: number }>
  const count = Number(out?.[0]?.result ?? 1)
  return { ok: count <= max, remaining: Math.max(0, max - count), resetMs: windowMs }
}

/** Returns true when the action is allowed. Applies `max` events per `windowMs`. */
export async function limit(key: string, max: number, windowMs: number): Promise<boolean> {
  try {
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
    const res =
      upstashUrl && upstashToken
        ? await limitUpstash(key, max, windowMs, upstashUrl, upstashToken)
        : await limitInMemory(key, max, windowMs)
    return res.ok
  } catch (err) {
    console.warn('rate-limit backend error (failing open):', err instanceof Error ? err.message : err)
    return true
  }
}

/** Best-effort client IP from proxy headers (Netlify sets x-nf-client-connection-ip). */
export function clientIp(req: Request): string {
  const h = req.headers
  return (
    h.get('x-nf-client-connection-ip') ??
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

/* ---- named policies (single place to tune) ---- */

export const POLICY = {
  login: { max: 5, windowMs: 15 * 60_000 }, // 5 attempts / 15 min, per IP+username
  signup: { max: 3, windowMs: 60 * 60_000 }, // 3 accounts / hour, per IP
  resetPassword: { max: 5, windowMs: 60 * 60_000 }, // 5 / hour, per IP
  passwordChange: { max: 5, windowMs: 60 * 60_000 }, // 5 / hour, per user
  llmChat: { max: 30, windowMs: 5 * 60_000 }, // 30 / 5 min, per user
} as const
