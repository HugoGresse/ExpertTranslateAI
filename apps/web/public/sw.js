// Offline shell for ExpertTranslateAI. Plain JS on purpose: the static build has no step that
// would emit an un-hashed worker from a TypeScript source.
const PREFIX = 'eta-shell-'
const CACHE = `${PREFIX}v2`
const SHELL = ['./', './manifest.webmanifest', './icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

const store = (event, request, response) => {
  if (!response.ok) return response
  const copy = response.clone()
  event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)))
  return response
}

const cacheFirst = (event) =>
  caches
    .match(event.request)
    .then((cached) => cached ?? fetch(event.request).then((r) => store(event, event.request, r)))

const networkFirst = (event, fallback) =>
  fetch(event.request)
    .then((r) => store(event, event.request, r))
    .catch(() => caches.match(event.request).then((cached) => cached ?? fallback()))

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.includes('/_astro/')) {
    event.respondWith(cacheFirst(event))
    return
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event, () => caches.match('./')))
    return
  }
  event.respondWith(networkFirst(event, () => Response.error()))
})
