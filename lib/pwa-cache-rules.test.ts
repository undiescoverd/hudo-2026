import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isCacheable, SHELL_URLS, STATIC_PREFIXES } from './pwa-cache-rules'
import manifest from '../app/manifest'
import type * as MiddlewareModule from '../middleware'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-anon-key'

const origin = 'https://app.hudo.test'
const ok = (path: string, method = 'GET') => isCacheable({ url: origin + path, method, origin })

test('allows shell and static assets', () => {
  for (const p of SHELL_URLS) assert.equal(ok(p), true, p)
  assert.equal(ok('/_next/static/chunks/main-abc.js'), true)
  assert.equal(ok('/icons/icon-192.png'), true)
})

test('denies authenticated HTML, API, and other pages', () => {
  for (const p of [
    '/',
    '/dashboard',
    '/videos/123',
    '/guest/tok',
    '/api/videos/1/playback-url',
    '/_next/image?url=x',
  ])
    assert.equal(ok(p), false, p)
})

test('denies non-GET, cross-origin, signed R2 URLs, malformed', () => {
  assert.equal(ok('/offline', 'POST'), false)
  assert.equal(
    isCacheable({
      url: 'https://acct.r2.cloudflarestorage.com/b/k.mp4?X-Amz-Signature=a',
      method: 'GET',
      origin,
    }),
    false
  )
  assert.equal(
    isCacheable({ url: 'https://cdn.example.com/_next/static/a.js', method: 'GET', origin }),
    false
  )
  assert.equal(ok('/icons/a.png?X-Amz-Signature=zz'), false)
  assert.equal(isCacheable({ url: 'not a url', method: 'GET', origin }), false)
})

test('public/sw.js mirrors the allowlist constants', () => {
  const sw = readFileSync(join(__dirname, '../public/sw.js'), 'utf8')
  const arr = (name: string) => {
    const m = sw.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))
    assert.ok(m, name)
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }
  assert.deepEqual(arr('SHELL_URLS'), [...SHELL_URLS])
  assert.deepEqual(arr('STATIC_PREFIXES'), [...STATIC_PREFIXES])
  assert.match(sw, /cloudflarestorage\.com/)
  assert.match(sw, /\/api\//)
})

test('manifest has installable fields and icons exist', () => {
  const m = manifest()
  assert.equal(m.display, 'standalone')
  assert.ok(m.name && m.start_url)
  assert.ok(m.icons?.some((i) => i.purpose === 'maskable'))
  for (const i of m.icons ?? []) {
    assert.ok(readFileSync(join(__dirname, '..', 'public', i.src)).length > 0, i.src)
    assert.ok((SHELL_URLS as readonly string[]).includes(i.src), i.src)
  }
})

test('offline page exists and is a public path', () => {
  const src = readFileSync(join(__dirname, '../app/offline/page.tsx'), 'utf8')
  assert.match(src, /export default function OfflinePage/)
  assert.doesNotMatch(src, /supabase|cookies\(/i) // no auth or data access
})

let mw: typeof MiddlewareModule
let matcher: RegExp
before(async () => {
  mw = await import('../middleware')
  matcher = new RegExp('^' + mw.config.matcher[0] + '$')
})

test('PWA paths bypass auth (matcher excludes or public)', () => {
  for (const p of [
    '/sw.js',
    '/manifest.webmanifest',
    '/icons/icon-192.png',
    '/icons/icon-maskable-512.png',
  ])
    assert.equal(matcher.test(p), false, p)
  assert.equal(mw.isPublicPath('/offline'), true)
})
