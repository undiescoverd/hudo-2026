/**
 * Behavioural tests for GET /api/guest/:token/playback-url, agency subscription gate
 * (S5-GUEST-003). The real handler runs with Supabase REST and Upstash stubbed at fetch.
 *
 * Run: pnpm exec tsx "app/api/guest/[token]/playback-url/route.behavior.test.ts"
 */

import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { afterEach, before, describe, it } from 'node:test'

const SB = 'https://sb.guest-playback.test'
const REDIS = 'https://redis.guest-playback.test'
const VIDEO = '22222222-2222-4222-8222-222222222222'
const VERSION = '33333333-3333-4333-8333-333333333333'
const AGENCY = '44444444-4444-4444-8444-444444444444'
const realFetch = globalThis.fetch

let GET: (req: NextRequest, ctx: { params: { token: string } }) => Promise<Response>
let hashGuestToken: (t: string) => string
let generateGuestToken: () => string

let calls: URL[] = []
let writes: Array<{ path: string; method: string }> = []
let token = ''
let expiresAt: string | null = null
let agencyStatus: string | null = 'active'
let agencyLookupFails = false
let viewCount = 1

function installFetch() {
  calls = []
  writes = []
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.origin === REDIS) {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      const n = Array.isArray(body) ? body.length : 1
      const items = Array.from({ length: n }, () => ({ result: 1 }))
      return Response.json(Array.isArray(body) ? items : items[0])
    }
    calls.push(url)
    const method = init.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') writes.push({ path: url.pathname, method })
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
      if (url.searchParams.get('token_hash') !== `eq.${hashGuestToken(token)}`) return rows([])
      return rows([
        {
          id: 'link-1',
          video_id: VIDEO,
          agency_id: AGENCY,
          created_by: 'creator-1',
          video_version_id: VERSION,
          token_hash: hashGuestToken(token),
          expires_at: expiresAt,
          revoked_at: null,
        },
      ])
    }
    if (url.pathname === '/rest/v1/agencies') {
      if (agencyLookupFails) return json(500, { message: 'boom' })
      return rows([{ subscription_status: agencyStatus }])
    }
    if (url.pathname === '/rest/v1/videos')
      return rows([{ id: VIDEO, title: 'Showreel', active_version_id: VERSION }])
    if (url.pathname === '/rest/v1/video_versions')
      return rows([{ id: VERSION, r2_key: 'agency/video/v1.mp4' }])
    if (url.pathname === '/rest/v1/rpc/increment_guest_link_view') return json(200, viewCount)
    if (url.pathname === '/rest/v1/memberships') return rows([{ user_id: 'creator-1' }])
    if (url.pathname === '/rest/v1/notifications') return json(201, [])
    return json(404, { message: `unexpected ${url.pathname}` })
  }) as typeof fetch
}

function request(t = token, query = '') {
  installFetch()
  const req = new NextRequest(`http://localhost:3000/api/guest/${t}/playback-url${query}`)
  return GET(req, { params: { token: t } })
}

const snapshot = async (res: Response) => ({
  status: res.status,
  body: await res.text(),
  retryAfter: res.headers.get('retry-after'),
})
const viewRpcs = () => calls.filter((u) => u.pathname === '/rest/v1/rpc/increment_guest_link_view')
const notificationWrites = () => writes.filter((w) => w.path === '/rest/v1/notifications')

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SB
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-guest-playback-test'
  process.env.UPSTASH_REDIS_REST_URL = REDIS
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-guest-playback-test'
  process.env.R2_ACCESS_KEY_ID = 'test-access-key'
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key'
  process.env.R2_ACCOUNT_ID = 'testaccount'
  process.env.R2_BUCKET_NAME = 'test-bucket'
  ;({ hashGuestToken, generateGuestToken } = await import('@/lib/guest-tokens'))
  ;({ GET } = await import('./route'))
})

afterEach(() => {
  globalThis.fetch = realFetch
  expiresAt = null
  agencyStatus = 'active'
  agencyLookupFails = false
  viewCount = 1
})

describe('GET /api/guest/:token/playback-url: agency subscription gate (S5-GUEST-003)', () => {
  it('canceled agency -> response identical to an expired link', async () => {
    token = generateGuestToken()
    expiresAt = new Date(Date.now() - 1000).toISOString()
    const expired = await snapshot(await request())
    expiresAt = null
    agencyStatus = 'canceled'
    const canceled = await snapshot(await request())
    assert.equal(canceled.status, 404)
    assert.deepEqual(canceled, expired)
  })

  it('canceled agency -> no view_count increment and no notification', async () => {
    token = generateGuestToken()
    agencyStatus = 'canceled'
    await request()
    assert.equal(viewRpcs().length, 0)
    assert.equal(notificationWrites().length, 0)
    assert.equal(calls.filter((u) => u.pathname === '/rest/v1/videos').length, 0)
  })

  for (const status of ['active', 'trialing', 'past_due', null]) {
    it(`status ${String(status)} -> signed URL returned, view counted, creator notified`, async () => {
      token = generateGuestToken()
      agencyStatus = status
      const res = await request()
      assert.equal(res.status, 200)
      const body = (await res.json()) as { url: string }
      assert.ok(body.url.startsWith('https://'))
      assert.equal(viewRpcs().length, 1)
      assert.equal(notificationWrites().length, 1)
    })
  }

  it('resubscribed: canceled then active serves the same link, no link row written', async () => {
    token = generateGuestToken()
    agencyStatus = 'canceled'
    assert.equal((await request()).status, 404)
    agencyStatus = 'active'
    assert.equal((await request()).status, 200)
    assert.equal(
      writes.filter((w) => w.path === '/rest/v1/guest_links').length,
      0,
      'guest_links is never written by the gate'
    )
  })

  it('agency lookup error fails closed with the expired-link response, no view counted', async () => {
    token = generateGuestToken()
    expiresAt = new Date(Date.now() - 1000).toISOString()
    const expired = await snapshot(await request())
    expiresAt = null
    agencyLookupFails = true
    const res = await request()
    assert.deepEqual(await snapshot(res), expired)
    assert.equal(viewRpcs().length, 0)
  })
})
