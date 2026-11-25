/**
 * Behavioural tests for POST/GET /api/videos/:videoId/guest-links (S5-GUEST-002).
 *
 * The real handlers run end to end with Supabase REST/Auth and Upstash stubbed at the
 * fetch layer and the Next request scope (cookies()) supplied via AsyncLocalStorage —
 * same approach as the status route behaviour test.
 *
 * Run: pnpm exec tsx "app/api/videos/[videoId]/guest-links/route.behavior.test.ts"
 */

import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import { afterEach, before, describe, it } from 'node:test'

const SB = 'https://sb.guest-links-route.test'
const REDIS = 'https://redis.guest-links-route.test'
const AGENCY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER = '11111111-1111-4111-8111-111111111111'
const VIDEO = '22222222-2222-4222-8222-222222222222'
const V1 = '33333333-3333-4333-8333-333333333331'
const V3 = '33333333-3333-4333-8333-333333333333'
const realFetch = globalThis.fetch

type Call = { method: string; url: URL; body: unknown }
type LinkRow = {
  id: string
  expires_at: string | null
  view_count: number
  last_viewed_at: string | null
  created_at: string
  label: string | null
  video_version_id: string | null
}

let calls: Call[] = []
let role = 'agent'
let redisCount = 1
let storedLinks: LinkRow[] = []
let versionsFail = false

let POST: (req: NextRequest, ctx: { params: { videoId: string } }) => Promise<Response>
let GET: (req: NextRequest, ctx: { params: { videoId: string } }) => Promise<Response>
let runInScope: <T>(fn: () => Promise<T>) => Promise<T>

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const method = (init.method ?? 'GET').toUpperCase()
    let body: unknown
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    if (url.origin === REDIS) {
      const n = Array.isArray(body) ? body.length : 1
      const items = Array.from({ length: n }, () => ({ result: redisCount }))
      return Response.json(Array.isArray(body) ? items : items[0])
    }
    calls.push({ method, url, body })
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

    if (url.pathname === '/auth/v1/user') {
      return json(200, {
        id: USER,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'agent@guest-links-route.test',
        app_metadata: {},
        user_metadata: { full_name: 'Alex Agent' },
        created_at: new Date().toISOString(),
      })
    }
    if (url.pathname === '/rest/v1/videos') {
      return rows([{ id: VIDEO, agency_id: AGENCY, active_version_id: V3 }])
    }
    if (url.pathname === '/rest/v1/memberships') {
      return rows([{ role, agency_id: AGENCY }])
    }
    if (url.pathname === '/rest/v1/video_versions') {
      if (versionsFail) return json(500, { message: 'versions down' })
      return rows([
        { id: V1, version_number: 1 },
        { id: V3, version_number: 3 },
      ])
    }
    if (url.pathname === '/rest/v1/guest_links' && method === 'POST') {
      const row = body as Record<string, unknown>
      return rows([
        {
          id: 'dead0000-0000-4000-8000-000000000001',
          expires_at: row.expires_at ?? null,
          created_at: '2026-01-01T00:00:00.000Z',
          label: row.label ?? null,
        },
      ])
    }
    if (url.pathname === '/rest/v1/guest_links' && method === 'GET') {
      // Emulate the `or=(expires_at.is.null,expires_at.gt.<iso>)` filter PostgREST would apply.
      const or = url.searchParams.get('or') ?? ''
      const m = /expires_at\.gt\.(.+?)\)?$/.exec(or)
      const cutoff = m ? new Date(m[1]).getTime() : null
      const visible = storedLinks.filter(
        (l) => cutoff === null || l.expires_at === null || new Date(l.expires_at).getTime() > cutoff
      )
      return rows(visible)
    }
    if (url.pathname === '/rest/v1/audit_log' && method === 'POST') return json(201, [])
    return json(404, { message: `unexpected ${method} ${url.pathname}` })
  }) as typeof fetch
}

function request(method: 'POST' | 'GET', body?: Record<string, unknown>) {
  calls = []
  installFetch()
  const req = new Request(`http://localhost:3000/api/videos/${VIDEO}/guest-links`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as unknown as NextRequest
  Object.defineProperty(req, 'nextUrl', { value: new URL(req.url) })
  const handler = method === 'POST' ? POST : GET
  return runInScope(() => handler(req, { params: { videoId: VIDEO } }))
}

const inserted = () =>
  calls.find((c) => c.url.pathname === '/rest/v1/guest_links' && c.method === 'POST')?.body as
    | Record<string, unknown>
    | undefined

const inFuture = (ms: number) => new Date(Date.now() + ms).toISOString()
const HOUR = 3600_000

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SB
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-guest-links-test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-guest-links-test'
  process.env.UPSTASH_REDIS_REST_URL = REDIS
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-guest-links-test'
  const { AsyncLocalStorage } = await import('node:async_hooks')
  ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
  const { requestAsyncStorage } =
    await import('next/dist/client/components/request-async-storage.external')
  const session = {
    access_token: 'access-guest-links-test',
    refresh_token: 'refresh-guest-links-test',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: USER, aud: 'authenticated' },
  }
  const cookieList = [{ name: 'sb-sb-auth-token', value: JSON.stringify(session) }]
  const cookies = { getAll: () => cookieList, set: () => {}, get: () => undefined }
  runInScope = (fn) =>
    requestAsyncStorage.run({ cookies, mutableCookies: cookies } as never, fn) as Promise<never>
  ;({ POST, GET } = await import('./route'))
})

afterEach(() => {
  globalThis.fetch = realFetch
  role = 'agent'
  redisCount = 1
  storedLinks = []
  versionsFail = false
})

describe('POST guest-links — label', () => {
  it('stores the label trimmed and echoes it back', async () => {
    const res = await request('POST', { label: '  BBC casting, Sam  ' })
    assert.equal(res.status, 201)
    assert.equal(inserted()?.label, 'BBC casting, Sam')
    assert.equal(((await res.json()) as { label: string }).label, 'BBC casting, Sam')
  })

  it('blank or absent label is omitted from the insert (DB default null)', async () => {
    await request('POST', { label: '   ' })
    assert.ok(inserted() && !('label' in inserted()!))
    await request('POST', {})
    assert.ok(inserted() && !('label' in inserted()!))
  })

  it('accepts exactly 80 characters and rejects 81 with 400 (nothing inserted)', async () => {
    const ok = await request('POST', { label: 'a'.repeat(80) })
    assert.equal(ok.status, 201)
    const res = await request('POST', { label: 'a'.repeat(81) })
    assert.equal(res.status, 400)
    assert.equal(inserted(), undefined)
  })

  it('rejects a non-string label with 400', async () => {
    const res = await request('POST', { label: 42 })
    assert.equal(res.status, 400)
    assert.equal(inserted(), undefined)
  })
})

describe('POST guest-links — expiry validation', () => {
  it('each preset (24h, 3d, 7d) is accepted and stored', async () => {
    for (const ms of [24 * HOUR, 72 * HOUR, 168 * HOUR]) {
      const at = inFuture(ms)
      const res = await request('POST', { expires_at: at })
      assert.equal(res.status, 201, `preset ${ms}`)
      assert.equal(inserted()?.expires_at, at)
    }
  })

  it('"Never" (null or omitted) stores a null expiry', async () => {
    assert.equal((await request('POST', { expires_at: null })).status, 201)
    assert.equal(inserted()?.expires_at, null)
    assert.equal((await request('POST', {})).status, 201)
    assert.equal(inserted()?.expires_at, null)
  })

  it('rejects a non-preset value beyond 7 days, a past date, garbage, and a non-string', async () => {
    for (const bad of [inFuture(30 * 24 * HOUR), inFuture(-HOUR), 'not-a-date', 12345]) {
      const res = await request('POST', { expires_at: bad })
      assert.equal(res.status, 400, String(bad))
      assert.equal(inserted(), undefined)
    }
  })

  it('pins the new link to the video active version', async () => {
    await request('POST', {})
    assert.equal(inserted()?.video_version_id, V3)
  })
})

describe('POST guest-links — auth, role and rate limit still enforced', () => {
  it('talent -> 403, nothing inserted', async () => {
    role = 'talent'
    const res = await request('POST', { label: 'x' })
    assert.equal(res.status, 403)
    assert.equal(inserted(), undefined)
  })

  it('over the limit -> 429 with Retry-After', async () => {
    redisCount = 10_000
    const res = await request('POST', {})
    assert.equal(res.status, 429)
    assert.ok(res.headers.get('retry-after'))
  })
})

describe('GET guest-links — list', () => {
  const row = (id: string, expires_at: string | null, version: string | null): LinkRow => ({
    id,
    expires_at,
    view_count: 0,
    last_viewed_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    label: `label ${id}`,
    video_version_id: version,
  })

  it('excludes expired links, keeps unexpired and never-expiring ones', async () => {
    storedLinks = [
      row('expired', inFuture(-HOUR), V3),
      row('live', inFuture(HOUR), V3),
      row('never', null, V3),
    ]
    const res = await request('GET')
    const { links } = (await res.json()) as { links: { id: string }[] }
    assert.deepEqual(links.map((l) => l.id).sort(), ['live', 'never'])
    const q = calls.find((c) => c.url.pathname === '/rest/v1/guest_links')
    assert.equal(q?.url.searchParams.get('revoked_at'), 'is.null')
  })

  it('returns the label, the pinned version number and the current version number', async () => {
    storedLinks = [row('old', null, V1), row('cur', null, V3), row('unpinned', null, null)]
    const body = (await (await request('GET')).json()) as {
      current_version_number: number | null
      links: { id: string; label: string; version_number: number | null }[]
    }
    assert.equal(body.current_version_number, 3)
    const byId = Object.fromEntries(body.links.map((l) => [l.id, l]))
    assert.equal(byId.old.version_number, 1)
    assert.equal(byId.cur.version_number, 3)
    assert.equal(byId.unpinned.version_number, null)
    assert.equal(byId.old.label, 'label old')
    assert.ok(!JSON.stringify(body).includes('token_hash'))
  })
})

describe('GET guest-links — version lookup', () => {
  it('scopes the version query to the pinned and active ids', async () => {
    storedLinks = [
      {
        id: 'a',
        expires_at: null,
        view_count: 0,
        last_viewed_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        label: null,
        video_version_id: V1,
      },
    ]
    await request('GET')
    const q = calls.find((c) => c.url.pathname === '/rest/v1/video_versions')
    const ids = q?.url.searchParams.get('id') ?? ''
    assert.ok(ids.startsWith('in.') && ids.includes(V1) && ids.includes(V3), ids)
  })

  it('a version query failure still returns the links with no nudge data', async () => {
    versionsFail = true
    storedLinks = [
      {
        id: 'a',
        expires_at: null,
        view_count: 0,
        last_viewed_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        label: 'x',
        video_version_id: V1,
      },
    ]
    const res = await request('GET')
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      current_version_number: number | null
      links: { id: string; version_number: number | null }[]
    }
    assert.equal(body.links.length, 1)
    assert.equal(body.links[0].version_number, null)
    assert.equal(body.current_version_number, null)
  })
})
