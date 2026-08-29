/* Ledger service worker — P3-3, hand-rolled (~150 lines, zero deps).
 *
 * The feature is CAPTURE, not full offline browsing: offline mutations are
 * queued in the app's IndexedDB outbox (P2-10) and replayed idempotently
 * (clientIds). The SW only caches the app shell so the book opens when the
 * network doesn't.
 *
 * Strategy:
 *   - App shell (documents + /_next/static + same-origin static assets):
 *     cache-first for hashed build assets, network-first-with-fallback for
 *     documents (you always get the newest shell when online).
 *   - /api/*: NEVER cached, NEVER queued here (the store owns mutations;
 *     double-writing is worse than an error). Pass straight through.
 *   - Kill-switch: bump SW_VERSION and the old cache drops; the unregister
 *     path lets a future release retire the worker cleanly.
 *
 * NOTE: netlify.toml serves /sw.js with `Cache-Control: no-cache` — do not
 * remove that header, or updates get stuck for a day.
 */

const SW_VERSION = 'ledger-sw-v1'
const SHELL_CACHE = `${SW_VERSION}-shell`
const PAGE_FALLBACK = '/offline.html'

const PRECACHE = [
  PAGE_FALLBACK,
  '/manifest.webmanifest',
  '/logo.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await cache.addAll(PRECACHE).catch(() => { /* offline fallback is best-effort */ })
      // activate as soon as install finishes — no waiting for old tabs
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // drop every cache from an older SW_VERSION
      const names = await caches.keys()
      await Promise.all(names.filter((n) => !n.startsWith(SW_VERSION)).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

/** Message hook for the kill-switch: `navigator.serviceWorker.controller.postMessage('unregister')` */
self.addEventListener('message', (event) => {
  if (event.data === 'unregister') {
    self.registration.unregister().then(() => self.clients.matchAll()).then((cs) => cs.forEach((c) => c.navigate(c.url)))
  }
})

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    /\.(?:css|js|woff2?|png|jpg|jpeg|svg|webp|ico|woff)$/.test(url.pathname)
  )
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return // mutations are the store's business
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return // never cache, never fake

  /* hashed build assets: cache-first (content-addressed, safe forever) */
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE)
        const hit = await cache.match(req)
        if (hit) return hit
        try {
          const res = await fetch(req)
          if (res.ok) cache.put(req, res.clone())
          return res
        } catch {
          return new Response('', { status: 504, statusText: 'offline' })
        }
      })(),
    )
    return
  }

  /* documents: network-first, fall back to cache then /offline.html */
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req)
          const cache = await caches.open(SHELL_CACHE)
          cache.put(req, res.clone()).catch(() => {})
          return res
        } catch {
          const cache = await caches.open(SHELL_CACHE)
          return (
            (await cache.match(req)) ||
            (await cache.match(PAGE_FALLBACK)) ||
            new Response('<h1>Ledger is offline</h1><p>Reconnect to open the book.</p>', {
              status: 503,
              headers: { 'Content-Type': 'text/html' },
            })
          )
        }
      })(),
    )
  }
})
