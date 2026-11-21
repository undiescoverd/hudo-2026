import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { shouldCache, type CacheRequest } from './pwa-cache-rules'

const ORIGIN = 'https://hudo.example'

function req(pathAndQuery: string, over: Partial<CacheRequest> = {}): CacheRequest {
  return { url: ORIGIN + pathAndQuery, method: 'GET', origin: ORIGIN, ...over }
}

const ALLOWED = [
  '/_next/static/chunks/main-abc123.js',
  '/_next/static/css/app.css',
  '/_next/static/media/font.woff2',
  '/_next/static/chunks/a.js?v=1',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/offline',
  '/manifest.webmanifest',
]

const DENIED = [
  // signed-in HTML
  '/',
  '/dashboard',
  '/videos/123e4567-e89b-12d3-a456-426614174000',
  '/talent',
  '/admin',
  '/settings/billing',
  // auth pages
  '/auth/signin',
  '/auth/callback?code=abc',
  '/auth/reset-password',
  // guest pages carry the token in the URL
  '/guest/sometoken',
  // API
  '/api/videos/x/playback-url',
  '/api/webhooks/stripe',
  '/api',
  // the service worker itself
  '/sw.js',
  // prefix confusion
  '/_next/staticx/a.js',
  '/_next/image?url=%2Fa.png',
  '/_next/data/build/dashboard.json',
  '/iconsx/a.png',
  '/icons/',
  '/offline/extra',
  '/offlinex',
  // query strings on exact-path entries
  '/offline?next=/dashboard',
  '/manifest.webmanifest?x=1',
  // traversal
  '/icons/../dashboard',
  '/icons/%2e%2e/dashboard',
  '/_next/static/%2e%2e/%2e%2e/dashboard',
]

describe('shouldCache: allowed', () => {
  for (const p of ALLOWED) {
    it(p, () => assert.equal(shouldCache(req(p)), true))
  }
})

describe('shouldCache: denied paths', () => {
  for (const p of DENIED) {
    it(p, () => assert.equal(shouldCache(req(p)), false))
  }
})

describe('shouldCache: other origins and signed R2 URLs', () => {
  const r2 =
    'https://acct.r2.cloudflarestorage.com/hudo-staging/videos/a/v1.mp4?X-Amz-Signature=abc&X-Amz-Expires=900'
  it('denies a signed R2 URL', () => {
    assert.equal(shouldCache({ url: r2, method: 'GET', origin: ORIGIN }), false)
  })
  it('denies an R2 URL even if its path looks like an allowed asset', () => {
    const u = 'https://acct.r2.cloudflarestorage.com/_next/static/a.js'
    assert.equal(shouldCache({ url: u, method: 'GET', origin: ORIGIN }), false)
  })
  it('denies a cross-origin static-looking URL', () => {
    const u = 'https://evil.example/_next/static/a.js'
    assert.equal(shouldCache({ url: u, method: 'GET', origin: ORIGIN }), false)
  })
  it('denies a cross-origin icon', () => {
    const u = 'https://cdn.example/icons/icon-192.png'
    assert.equal(shouldCache({ url: u, method: 'GET', origin: ORIGIN }), false)
  })
  it('denies a lookalike host', () => {
    const u = 'https://hudo.example.evil.com/icons/icon-192.png'
    assert.equal(shouldCache({ url: u, method: 'GET', origin: ORIGIN }), false)
  })
  it('denies a different scheme on the same host', () => {
    const u = 'http://hudo.example/icons/icon-192.png'
    assert.equal(shouldCache({ url: u, method: 'GET', origin: ORIGIN }), false)
  })
})

describe('shouldCache: method and credentials', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    it(`denies ${method} on an allowed path`, () => {
      assert.equal(shouldCache(req('/icons/icon-192.png', { method })), false)
    })
  }
  it('accepts a lowercase get', () => {
    assert.equal(shouldCache(req('/icons/icon-192.png', { method: 'get' })), true)
  })
  it('denies a request carrying an Authorization header', () => {
    assert.equal(shouldCache(req('/icons/icon-192.png', { hasAuthorization: true })), false)
    assert.equal(shouldCache(req('/_next/static/a.js', { hasAuthorization: true })), false)
  })
  it('allows when hasAuthorization is explicitly false', () => {
    assert.equal(shouldCache(req('/offline', { hasAuthorization: false })), true)
  })
})

describe('shouldCache: malformed input', () => {
  it('denies an unparseable URL', () => {
    assert.equal(shouldCache({ url: 'not a url', method: 'GET', origin: ORIGIN }), false)
  })
  it('denies an empty URL', () => {
    assert.equal(shouldCache({ url: '', method: 'GET', origin: ORIGIN }), false)
  })
  it('denies a relative URL', () => {
    assert.equal(shouldCache({ url: '/icons/a.png', method: 'GET', origin: ORIGIN }), false)
  })
})

describe('public/sw.js stays in sync with lib/pwa-cache-rules.ts', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8')
  const sandbox: Record<string, unknown> = {
    URL,
    self: { addEventListener() {}, location: { origin: ORIGIN } },
    caches: {},
  }
  vm.runInNewContext(src, sandbox)
  const swShouldCache = sandbox.shouldCache as (r: CacheRequest) => boolean

  it('exposes shouldCache', () => assert.equal(typeof swShouldCache, 'function'))

  const cases: CacheRequest[] = [
    ...[...ALLOWED, ...DENIED].map((p) => req(p)),
    ...['POST', 'PUT', 'HEAD', 'get'].map((m) => req('/icons/icon-192.png', { method: m })),
    req('/icons/icon-192.png', { hasAuthorization: true }),
    req('/offline', { hasAuthorization: false }),
    {
      url: 'https://acct.r2.cloudflarestorage.com/b/k.mp4?X-Amz-Signature=a',
      method: 'GET',
      origin: ORIGIN,
    },
    { url: 'https://evil.example/_next/static/a.js', method: 'GET', origin: ORIGIN },
    { url: 'http://hudo.example/icons/icon-192.png', method: 'GET', origin: ORIGIN },
    { url: 'not a url', method: 'GET', origin: ORIGIN },
    { url: '', method: 'GET', origin: ORIGIN },
  ]
  for (const c of cases) {
    it(`agrees on ${c.method} ${c.url}${c.hasAuthorization ? ' (auth)' : ''}`, () => {
      assert.equal(swShouldCache(c), shouldCache(c))
    })
  }
})
