/**
 * Behavioural tests for GET /api/guest/:token and getGuestMetadata (S5-GUEST-001).
 *
 * The real handler runs end to end with Supabase REST and Upstash stubbed at the fetch
 * layer. Guests see the video only: the response must carry no comments, and the
 * comments table must never be queried.
 *
 * Run: pnpm exec tsx "app/api/guest/[token]/route.behavior.test.ts"
 */

import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import { afterEach, before, describe, it } from 'node:test'

const SB = 'https://sb.guest-route.test'
const REDIS = 'https://redis.guest-route.test'
const VIDEO = '22222222-2222-4222-8222-222222222222'
const VERSION = '33333333-3333-4333-8333-333333333333'
const realFetch = globalThis.fetch

let GET: (req: NextRequest, ctx: { params: { token: string } }) => Promise<Response>
let getGuestMetadata: (token: string) => Promise<unknown>
let hashGuestToken: (t: string) => string
let generateGuestToken: () => string

let calls: URL[] = []
let token = ''
let revokedAt: string | null = null
let expiresAt: string | null = null
let redisCount = 1

function installFetch() {
  calls = []
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.origin === REDIS) {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      const n = Array.isArray(body) ? body.length : 1
      const items = Array.from({ length: n }, () => ({ result: redisCount }))
      return Response.json(Array.isArray(body) ? items : items[0])
    }
    calls.push(url)
    const json = (status: number, b: unknown) =>
      new Response(JSON.stringify(b), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    const wantsObject = new Headers(init.headers).get('accept')?.includes('pgrst.object')
    const rows = (list: unknown[]) =>
      wantsObject
        ? list.length
          ? json(200, list[0])
          : json(406, { code: 'PGRST116', message: 'no rows', details: '', hint: null })
        : json(200, list)

    if (url.pathname === '/rest/v1/guest_links') {
      const wanted = url.searchParams.get('token_hash')
      if (wanted !== `eq.${hashGuestToken(token)}`) return rows([])
      return rows([
        {
          id: 'link-1',
          video_id: VIDEO,
          video_version_id: VERSION,
          token_hash: hashGuestToken(token),
          expires_at: expiresAt,
          revoked_at: revokedAt,
        },
      ])
    }
    if (url.pathname === '/rest/v1/videos') {
      return rows([
        {
          id: VIDEO,
          title: 'Showreel',
          description: null,
          status: 'in_review',
          active_version_id: VERSION,
        },
      ])
    }
    if (url.pathname === '/rest/v1/video_versions') {
      return rows([{ id: VERSION, version_number: 1, duration_seconds: 12 }])
    }
    if (url.pathname === '/rest/v1/comments') {
      // A regression that queries comments would get data back and leak it.
      return rows([
        {
          id: 'c1',
          content: 'INTERNAL AGENT NOTE',
          timestamp_seconds: 3,
          created_at: '2026-01-01T00:00:00.000Z',
          users: { full_name: 'Alex Agent' },
        },
      ])
    }
    return json(404, { message: `unexpected ${url.pathname}` })
  }) as typeof fetch
}

const commentQueries = () => calls.filter((u) => u.pathname === '/rest/v1/comments')

function request(t = token) {
  installFetch()
  const req = new Request(`http://localhost:3000/api/guest/${t}`) as unknown as NextRequest
  return GET(req, { params: { token: t } })
}

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SB
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-guest-route-test'
  process.env.UPSTASH_REDIS_REST_URL = REDIS
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-guest-route-test'
  ;({ hashGuestToken, generateGuestToken } = await import('@/lib/guest-tokens'))
  ;({ getGuestMetadata } = await import('@/lib/guest/get-guest-metadata'))
  ;({ GET } = await import('./route'))
})

afterEach(() => {
  globalThis.fetch = realFetch
  revokedAt = null
  expiresAt = null
  redisCount = 1
})

describe('GET /api/guest/:token: video only (real handler)', () => {
  it('valid link: 200, video + version only, no comments key, comments table never queried', async () => {
    token = generateGuestToken()
    const res = await request()
    assert.equal(res.status, 200)
    const body = (await res.json()) as Record<string, unknown>
    assert.deepEqual(Object.keys(body).sort(), ['version', 'video'])
    assert.equal((body.video as { title: string }).title, 'Showreel')
    assert.equal(commentQueries().length, 0)
    assert.doesNotMatch(JSON.stringify(body), /INTERNAL AGENT NOTE|Alex Agent|r2_key|token_hash/)
  })

  it('getGuestMetadata returns no comments and makes no comments query', async () => {
    token = generateGuestToken()
    installFetch()
    const meta = (await getGuestMetadata(token)) as Record<string, unknown>
    assert.ok(meta)
    assert.equal('comments' in meta, false)
    assert.equal(commentQueries().length, 0)
  })

  it('unknown token -> 404', async () => {
    token = generateGuestToken()
    const res = await request(generateGuestToken())
    assert.equal(res.status, 404)
    assert.equal(commentQueries().length, 0)
  })

  it('revoked link -> 404', async () => {
    token = generateGuestToken()
    revokedAt = new Date().toISOString()
    assert.equal((await request()).status, 404)
  })

  it('expired link -> 404', async () => {
    token = generateGuestToken()
    expiresAt = new Date(Date.now() - 1000).toISOString()
    assert.equal((await request()).status, 404)
  })

  it('over the rate limit -> 429 with Retry-After, no data read', async () => {
    token = generateGuestToken()
    redisCount = 10_000
    const res = await request()
    assert.equal(res.status, 429)
    assert.ok(res.headers.get('retry-after'))
    assert.equal(calls.length, 0)
  })
})
