/**
 * Service-worker cache allowlist (S4-PWA-001).
 *
 * The SW may cache ONLY the public app shell and immutable static assets.
 * Never: HTML behind login, /api responses, signed R2 URLs, or anything
 * cross-origin. Default is deny.
 *
 * public/sw.js is plain JS (no build step) and MUST mirror this file: same
 * SHELL_URLS, STATIC_PREFIXES and denial checks. lib/pwa-cache-rules.test.ts
 * reads public/sw.js and asserts the shared constants match, so drift fails CI.
 */

/**
 * Cache name = CACHE_PREFIX + CACHE_VERSION. Bump CACHE_VERSION (here AND in
 * public/sw.js) whenever the shell changes (offline page, icons, manifest).
 */
export const CACHE_PREFIX = 'hudo-shell-'
export const CACHE_VERSION = 'v1'

/** Max cached /_next/static entries; oldest evicted first. */
export const MAX_STATIC_ENTRIES = 60

/** Public pages/files precached at install. /offline renders without auth. */
export const SHELL_URLS = [
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
] as const

/** Path prefixes of immutable static assets (hashed build output, icons). */
export const STATIC_PREFIXES = ['/_next/static/', '/icons/'] as const

export interface CacheCandidate {
  url: string
  method: string
  /** The service worker's own origin. */
  origin: string
}

export function isCacheable({ url, method, origin }: CacheCandidate): boolean {
  if (method.toUpperCase() !== 'GET') return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.origin !== origin) return false
  if (u.hostname.endsWith('cloudflarestorage.com')) return false
  if (u.search) return false // no query strings: avoids per-URL cache bloat and signed URLs
  if (u.pathname.startsWith('/api/')) return false
  if (/x-amz-signature/i.test(u.search)) return false
  if ((SHELL_URLS as readonly string[]).includes(u.pathname)) return true
  return STATIC_PREFIXES.some((p) => u.pathname.startsWith(p))
}
