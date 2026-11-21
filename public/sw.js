/* Hudo service worker (S4-PWA-001): app shell + static assets only.
 *
 * Never cached: signed-in HTML, /api, cross-origin requests (incl. signed R2
 * URLs), requests with an Authorization header, non-GET requests. Those are
 * simply not intercepted, so they go straight to the network.
 *
 * `shouldCache` is a hand-kept copy of lib/pwa-cache-rules.ts. A unit test
 * (lib/pwa-cache-rules.test.ts) loads this file and asserts both agree.
 */

var CACHE_NAME = 'hudo-shell-v1'
var OFFLINE_URL = '/offline'
var PRECACHE = [
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
]

var STATIC_PREFIXES = ['/_next/static/', '/icons/']
var SHELL_PATHS = ['/offline', '/manifest.webmanifest']

function shouldCache(req) {
  if (String(req.method).toUpperCase() !== 'GET') return false
  if (req.hasAuthorization) return false

  var url
  try {
    url = new URL(req.url)
  } catch (e) {
    return false
  }
  if (url.origin !== req.origin) return false

  var pathname = url.pathname
  if (/%2e|%2f|%5c|\\/i.test(pathname)) return false

  if (SHELL_PATHS.indexOf(pathname) !== -1) return url.search === ''
  return STATIC_PREFIXES.some(function (p) {
    return pathname.indexOf(p) === 0 && pathname.length > p.length
  })
}

function toRule(request) {
  return {
    url: request.url,
    method: request.method,
    origin: self.location.origin,
    hasAuthorization: request.headers.has('Authorization'),
  }
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(PRECACHE)
      })
      .then(function () {
        return self.skipWaiting()
      })
  )
})

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) {
              return k !== CACHE_NAME
            })
            .map(function (k) {
              return caches.delete(k)
            })
        )
      })
      .then(function () {
        return self.clients.claim()
      })
  )
})

self.addEventListener('fetch', function (event) {
  var request = event.request

  // Navigations are never cached; offline falls back to the cached /offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(function () {
        return caches.match(OFFLINE_URL).then(function (res) {
          return res || Response.error()
        })
      })
    )
    return
  }

  if (!shouldCache(toRule(request))) return // not intercepted: straight to network

  event.respondWith(
    caches.match(request).then(function (hit) {
      if (hit) return hit
      return fetch(request).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone()
          caches.open(CACHE_NAME).then(function (cache) {
            return cache.put(request, copy)
          })
        }
        return res
      })
    })
  )
})
