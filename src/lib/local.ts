'use client'
/* P2-10: local-first primitives — hand-rolled IndexedDB, no new deps.
 *
 * READ PATH:  boot paints from the mirror (instant), then /api/auth/me
 *             reconciles in the background. Cold boot target: < 100ms.
 * WRITE PATH: every mutation is optimistic in the store; when the network
 *             fails, the request lands in a durable outbox and replays on
 *             reconnect (online event + interval). Replays are idempotent:
 *             captures stamp clientIds, the server upserts on
 *             (userId, clientId) instead of appending duplicates.
 *
 * Cache discipline (risk register): keyed per userId; impersonation
 * bypasses the mirror entirely (nothing read or written while viewing
 * someone else's book).
 */

const DB_NAME = 'ledger-local'
const DB_VERSION = 1
const MIRROR = 'mirror' // keyStore: one row per userId → full Ledger JSON
const OUTBOX = 'outbox' // keyPath seq: queued failed mutations, FIFO
const LAST_USER_KEY = 'ledger_last_user'
const SEQ_KEY = 'ledger_outbox_seq'

export interface OutboxEntry {
  seq: number
  url: string
  method: string
  body: string | null
  createdAt: number
  attempts: number
  userId: string | null // only replay under the account that queued it
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const d = req.result
        if (!d.objectStoreNames.contains(MIRROR)) d.createObjectStore(MIRROR)
        if (!d.objectStoreNames.contains(OUTBOX)) d.createObjectStore(OUTBOX, { keyPath: 'seq' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function txDone(t: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    t.oncomplete = () => resolve()
    t.onerror = () => resolve()
    t.onabort = () => resolve()
  })
}

/* ---------- mirror ---------- */

export function lastUserId(): string | null {
  try {
    return localStorage.getItem(LAST_USER_KEY)
  } catch {
    return null
  }
}

export function rememberUserId(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(LAST_USER_KEY, userId)
    else localStorage.removeItem(LAST_USER_KEY)
  } catch { /* ignore */ }
}

/** Persist a full ledger snapshot for one user (fire-and-forget). */
export async function saveMirror(userId: string, ledger: unknown): Promise<void> {
  const d = await openDb()
  if (!d) return
  const t = d.transaction(MIRROR, 'readwrite')
  t.objectStore(MIRROR).put(ledger, userId)
  await txDone(t)
  d.close()
}

/** Load the cached ledger for a user — null on any failure (cold start). */
export async function loadMirror<T>(userId: string): Promise<T | null> {
  const d = await openDb()
  if (!d) return null
  return new Promise<T | null>((resolve) => {
    try {
      const t = d.transaction(MIRROR, 'readonly')
      const req = t.objectStore(MIRROR).get(userId)
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  }).finally(() => d.close())
}

export async function clearMirror(userId: string): Promise<void> {
  const d = await openDb()
  if (!d) return
  const t = d.transaction(MIRROR, 'readwrite')
  t.objectStore(MIRROR).delete(userId)
  await txDone(t)
  d.close()
}

/* ---------- outbox ---------- */

function nextSeq(): number {
  try {
    const n = (Number(localStorage.getItem(SEQ_KEY)) || 0) + 1
    localStorage.setItem(SEQ_KEY, String(n))
    return n
  } catch {
    return Date.now()
  }
}

export async function enqueue(entry: Omit<OutboxEntry, 'seq' | 'attempts'>): Promise<void> {
  const d = await openDb()
  if (!d) return
  const t = d.transaction(OUTBOX, 'readwrite')
  t.objectStore(OUTBOX).put({ ...entry, seq: nextSeq(), attempts: 0 })
  await txDone(t)
  d.close()
}

export async function outboxAll(): Promise<OutboxEntry[]> {
  const d = await openDb()
  if (!d) return []
  return new Promise<OutboxEntry[]>((resolve) => {
    try {
      const t = d.transaction(OUTBOX, 'readonly')
      const req = t.objectStore(OUTBOX).getAll()
      req.onsuccess = () => resolve(((req.result as OutboxEntry[] | undefined) ?? []).sort((a, b) => a.seq - b.seq))
      req.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  }).finally(() => d.close())
}

export async function outboxCount(): Promise<number> {
  const all = await outboxAll()
  return all.length
}

export async function outboxDelete(seq: number): Promise<void> {
  const d = await openDb()
  if (!d) return
  const t = d.transaction(OUTBOX, 'readwrite')
  t.objectStore(OUTBOX).delete(seq)
  await txDone(t)
  d.close()
}

export async function outboxBumpAttempts(seq: number, attempts: number): Promise<void> {
  const d = await openDb()
  if (!d) return
  await new Promise<void>((resolve) => {
    try {
      const t = d.transaction(OUTBOX, 'readwrite')
      const store = t.objectStore(OUTBOX)
      const g = store.get(seq)
      g.onsuccess = () => {
        const cur = g.result as OutboxEntry | undefined
        if (cur) store.put({ ...cur, attempts })
      }
      t.oncomplete = () => resolve()
      t.onerror = () => resolve()
      t.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
  d.close()
}

/* ---------- client ids (idempotency keys) ---------- */

/** A per-capture id: enough entropy to never collide, no dependencies. */
export function clientId(prefix = 'c'): string {
  const rnd = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${rnd}`
}
