/**
 * Rate limit for GET /api/guest/:token/playback-url, through the real handler
 * (separate file: lib/redis reads Upstash env at import, so env is set before the
 * first import here).
 *
 * Run: pnpm exec tsx "app/api/guest/[token]/playback-url/route.rate-limit.test.ts"
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

describe('guest playback-url — rate limit (real handler)', () => {
  const TOKEN = 'rate-limit-guest-token'
  const REDIS = 'https://redis.guest-playback.test'
  const originalFetch = globalThis.fetch
  const saved: Record<string, string | undefined> = {}
  const fetched: string[] = []

  before(() => {
    for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'])
      saved[k] = process.env[k]
    process.env.UPSTASH_REDIS_REST_URL = REDIS
    process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-token'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      fetched.push(url.origin)
      assert.equal(url.origin, REDIS, 'over the limit nothing but Redis may be called')
      const body = JSON.parse(String(init?.body ?? '[]'))
      const items = Array.isArray(body) ? body.map(() => ({ result: 10_000 })) : { result: 10_000 }
      return Response.json(items)
    }) as typeof fetch
  })

  after(() => {
    globalThis.fetch = originalFetch
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('over the limit -> 429 with Retry-After, before any DB lookup or notification', async () => {
    const { NextRequest } = await import('next/server')
    const { GET } = await import('./route')
    const req = new NextRequest(`https://hudo.test/api/guest/${TOKEN}/playback-url`)
    const res = await GET(req, { params: { token: TOKEN } })
    assert.equal(res.status, 429)
    assert.ok(res.headers.get('retry-after'))
    assert.ok(fetched.length > 0 && fetched.every((o) => o === REDIS))
  })
})
