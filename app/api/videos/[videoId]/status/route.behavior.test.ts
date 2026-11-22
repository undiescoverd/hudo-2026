/**
 * Behavioural tests for PATCH/GET /api/videos/:videoId/status (S5-FLOW-001).
 *
 * The real handlers run end to end with Supabase REST/Auth and Upstash stubbed at the
 * fetch layer and the Next request scope (cookies()) supplied via AsyncLocalStorage —
 * the same approach as the comments route test.
 *
 * Run: pnpm exec tsx "app/api/videos/[videoId]/status/route.behavior.test.ts"
 */

import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import { afterEach, before, describe, it } from 'node:test'

const SB = 'https://sb.status-route.test'
const REDIS = 'https://redis.status-route.test'
const AGENCY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER = '11111111-1111-4111-8111-111111111111'
const VIDEO = '22222222-2222-4222-8222-222222222222'
const ACTIVE_VERSION = '33333333-3333-4333-8333-333333333333'
const LATEST_VERSION = '33333333-3333-4333-8333-444444444444'
const realFetch = globalThis.fetch

type Call = { method: string; url: URL; body: unknown }

let calls: Call[] = []
let role = 'agent'
let videoStatus = 'in_review'
let activeVersionId: string | null = ACTIVE_VERSION
let openCount: number | 'error' = 0
let auditActor: string | null = 'Alex Agent'
// What Upstash INCR returns: 1 = under any limit, large = limit exceeded.
let redisCount = 1
// Simulates losing the conditional-update race: no row still matches status=pending_review.
let raceLost = false
let membershipAgency = AGENCY
let auditFails = false
let revertFails = false

let PATCH: (req: NextRequest, ctx: { params: { videoId: string } }) => Promise<Response>
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
    const json = (status: number, b: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(b), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      })
    // PostgREST returns an object for .single()/.maybeSingle() requests, an array otherwise.
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
        email: 'agent@status-route.test',
        app_metadata: {},
        user_metadata: { full_name: 'Alex Agent' },
        created_at: new Date().toISOString(),
      })
    }
    if (url.pathname === '/rest/v1/videos' && method === 'GET') {
      return rows([
        {
          id: VIDEO,
          agency_id: AGENCY,
          // A talent caller owns the video, so the 403 comes from canTransition, not access.
          talent_id: role === 'talent' ? USER : '99999999-9999-4999-8999-999999999999',
          status: videoStatus,
          active_version_id: activeVersionId,
        },
      ])
    }
    if (url.pathname === '/rest/v1/videos' && method === 'PATCH') {
      // .select() after .update() asks for return=representation: report matched rows.
      const wantsRows = new Headers(init.headers).get('prefer')?.includes('return=representation')
      if (revertFails && url.searchParams.get('status') === 'eq.in_review')
        return json(500, { message: 'revert down' })
      if (!wantsRows) return new Response(null, { status: 204 })
      const guard = url.searchParams.get('status')
      const matches = guard === null || (guard === 'eq.pending_review' && !raceLost)
      return json(200, matches ? [{ id: VIDEO }] : [])
    }
    if (url.pathname === '/rest/v1/memberships') {
      return rows([{ role, agency_id: membershipAgency }])
    }
    if (url.pathname === '/rest/v1/video_versions') {
      return rows([{ id: LATEST_VERSION }])
    }
    if (url.pathname === '/rest/v1/comments') {
      if (openCount === 'error') return json(500, { message: 'boom' })
      return new Response(null, { status: 200, headers: { 'content-range': `*/${openCount}` } })
    }
    if (url.pathname === '/rest/v1/audit_log' && method === 'POST')
      return auditFails ? json(500, { message: 'audit down' }) : json(201, [])
    if (url.pathname === '/rest/v1/audit_log' && method === 'GET') {
      return rows(
        auditActor === null
          ? []
          : [{ actor_name: auditActor, created_at: '2026-01-01T00:00:00.000Z' }]
      )
    }
    return json(404, { message: `unexpected ${method} ${url.pathname}` })
  }) as typeof fetch
}

const auditInserts = () =>
  calls.filter((c) => c.url.pathname === '/rest/v1/audit_log' && c.method === 'POST')
const videoUpdates = () =>
  calls.filter((c) => c.url.pathname === '/rest/v1/videos' && c.method === 'PATCH')

function request(method: 'PATCH' | 'GET', status?: string, extra: Record<string, unknown> = {}) {
  calls = []
  installFetch()
  const req = new Request(`http://localhost:3000/api/videos/${VIDEO}/status`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(status ? { body: JSON.stringify({ status, ...extra }) } : {}),
  }) as unknown as NextRequest
  const handler = method === 'PATCH' ? PATCH : GET
  return runInScope(() => handler(req, { params: { videoId: VIDEO } }))
}

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SB
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-status-route-test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-status-route-test'
  process.env.UPSTASH_REDIS_REST_URL = REDIS
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-status-route-test'
  const { AsyncLocalStorage } = await import('node:async_hooks')
  ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
  const { requestAsyncStorage } =
    await import('next/dist/client/components/request-async-storage.external')
  const session = {
    access_token: 'access-status-route-test',
    refresh_token: 'refresh-status-route-test',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: USER, aud: 'authenticated' },
  }
  const cookieList = [{ name: 'sb-sb-auth-token', value: JSON.stringify(session) }]
  const cookies = { getAll: () => cookieList, set: () => {}, get: () => undefined }
  runInScope = (fn) =>
    requestAsyncStorage.run({ cookies, mutableCookies: cookies } as never, fn) as Promise<never>
  ;({ PATCH, GET } = await import('./route'))
})

afterEach(() => {
  globalThis.fetch = realFetch
  role = 'agent'
  videoStatus = 'in_review'
  activeVersionId = ACTIVE_VERSION
  openCount = 0
  auditActor = 'Alex Agent'
  redisCount = 1
  raceLost = false
  auditFails = false
  membershipAgency = AGENCY
  revertFails = false
})

describe('status route — role gate and rate limit (real handlers)', () => {
  it('PATCH as talent: only pending_review is allowed, approved is 403 with no audit or update', async () => {
    role = 'talent'
    videoStatus = 'draft'
    const res = await request('PATCH', 'approved')
    assert.equal(res.status, 403)
    assert.equal(auditInserts().length, 0)
    assert.equal(videoUpdates().length, 0)
  })

  it('PATCH as talent cannot request changes either (guard never reached)', async () => {
    role = 'talent'
    openCount = 3
    const res = await request('PATCH', 'changes_requested')
    assert.equal(res.status, 403)
    assert.equal(auditInserts().length, 0)
  })

  it('membership lookup is scoped to the signed-in user', async () => {
    await request('PATCH', 'approved')
    const m = calls.find((c) => c.url.pathname === '/rest/v1/memberships')
    assert.equal(m?.url.searchParams.get('user_id'), `eq.${USER}`)
  })

  it('PATCH over the limit -> 429 with Retry-After, nothing written', async () => {
    redisCount = 10_000
    const res = await request('PATCH', 'approved')
    assert.equal(res.status, 429)
    assert.ok(res.headers.get('retry-after'))
    assert.equal(auditInserts().length, 0)
  })

  it('GET over the limit -> 429 with Retry-After', async () => {
    redisCount = 10_000
    const res = await request('GET')
    assert.equal(res.status, 429)
    assert.ok(res.headers.get('retry-after'))
  })
})

describe('PATCH status — changes_requested guard (real handler)', () => {
  it('zero open comments -> 409 no_open_comments, no audit insert, no update', async () => {
    openCount = 0
    const res = await request('PATCH', 'changes_requested')
    assert.equal(res.status, 409)
    const body = (await res.json()) as { code: string; error: string }
    assert.equal(body.code, 'no_open_comments')
    assert.match(body.error, /open comment/)
    assert.equal(auditInserts().length, 0)
    assert.equal(videoUpdates().length, 0)
  })

  it('one open comment -> 200, audited, and the video is updated', async () => {
    openCount = 1
    const res = await request('PATCH', 'changes_requested')
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { id: VIDEO, status: 'changes_requested' })
    assert.equal(auditInserts().length, 1)
    assert.equal(videoUpdates().length, 1)
  })

  it('counts open comments on active_version_id only (unresolved, undeleted, top-level)', async () => {
    openCount = 2
    await request('PATCH', 'changes_requested')
    const count = calls.find((c) => c.url.pathname === '/rest/v1/comments')
    assert.ok(count)
    const q = count.url.searchParams
    assert.equal(q.get('video_version_id'), `eq.${ACTIVE_VERSION}`)
    assert.equal(q.get('resolved'), 'eq.false')
    assert.equal(q.get('deleted_at'), 'is.null')
    assert.equal(q.get('parent_id'), 'is.null')
  })

  it('no active_version_id -> falls back to the latest version', async () => {
    activeVersionId = null
    openCount = 1
    const res = await request('PATCH', 'changes_requested')
    assert.equal(res.status, 200)
    const versionLookup = calls.find((c) => c.url.pathname === '/rest/v1/video_versions')
    assert.ok(versionLookup, 'must look the latest version up')
    assert.equal(versionLookup.url.searchParams.get('order'), 'version_number.desc')
    const count = calls.find((c) => c.url.pathname === '/rest/v1/comments')
    assert.equal(count?.url.searchParams.get('video_version_id'), `eq.${LATEST_VERSION}`)
  })

  it('comment count query failure -> 500, nothing audited or updated', async () => {
    openCount = 'error'
    const res = await request('PATCH', 'changes_requested')
    assert.equal(res.status, 500)
    assert.equal(auditInserts().length, 0)
    assert.equal(videoUpdates().length, 0)
  })

  it('approve with zero open comments is never blocked and does not count comments', async () => {
    openCount = 0
    const res = await request('PATCH', 'approved')
    assert.equal(res.status, 200)
    assert.equal(
      calls.filter((c) => c.url.pathname === '/rest/v1/comments').length,
      0,
      'only changes_requested needs the count'
    )
  })
})

describe('GET status — changed-by info (real handler)', () => {
  it('talent -> 403 and never reads audit_log', async () => {
    role = 'talent'
    const res = await request('GET')
    assert.equal(res.status, 403)
    assert.equal(calls.filter((c) => c.url.pathname === '/rest/v1/audit_log').length, 0)
  })

  it('agent -> actor name, time and open count', async () => {
    openCount = 3
    const res = await request('GET')
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), {
      changedBy: 'Alex Agent',
      changedAt: '2026-01-01T00:00:00.000Z',
      openComments: 3,
    })
  })

  it('never returns an email-shaped actor_name', async () => {
    auditActor = 'someone@agency.test'
    const body = (await (await request('GET')).json()) as { changedBy: string | null }
    assert.equal(body.changedBy, null)
  })

  it('count error -> openComments null, not 0', async () => {
    openCount = 'error'
    const res = await request('GET')
    assert.equal(res.status, 200)
    assert.equal(((await res.json()) as { openComments: unknown }).openComments, null)
  })

  it('no status change recorded yet -> null name and time', async () => {
    auditActor = null
    const body = (await (await request('GET')).json()) as { changedBy: unknown; changedAt: unknown }
    assert.equal(body.changedBy, null)
    assert.equal(body.changedAt, null)
  })
})

describe('PATCH status — auto In review on agent open (S5-FLOW-002)', () => {
  it('agent opening a pending_review video: in_review, one audit row, one conditional update', async () => {
    videoStatus = 'pending_review'
    const res = await request('PATCH', 'in_review', { autoOpen: true })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { id: VIDEO, status: 'in_review', changed: true })
    assert.equal(auditInserts().length, 1)
    assert.deepEqual((auditInserts()[0].body as { metadata: unknown }).metadata, {
      old_status: 'pending_review',
      new_status: 'in_review',
      trigger: 'auto_open',
    })
    assert.equal(videoUpdates().length, 1)
    assert.equal(videoUpdates()[0].url.searchParams.get('status'), 'eq.pending_review')
  })

  it('owner and admin_agent trigger it too', async () => {
    for (const r of ['owner', 'admin_agent']) {
      role = r
      videoStatus = 'pending_review'
      const res = await request('PATCH', 'in_review', { autoOpen: true })
      assert.equal(res.status, 200)
      assert.equal(((await res.json()) as { changed: boolean }).changed, true)
    }
  })

  it('talent never triggers it: 403, no update, no audit', async () => {
    role = 'talent'
    videoStatus = 'pending_review'
    const res = await request('PATCH', 'in_review', { autoOpen: true })
    assert.equal(res.status, 403)
    assert.equal(videoUpdates().length, 0)
    assert.equal(auditInserts().length, 0)
  })

  it('already in_review is an idempotent no-op: 200 changed:false, no update, no audit', async () => {
    videoStatus = 'in_review'
    const res = await request('PATCH', 'in_review', { autoOpen: true })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { id: VIDEO, status: 'in_review', changed: false })
    assert.equal(videoUpdates().length, 0)
    assert.equal(auditInserts().length, 0)
  })

  it('never overrides other states (approved stays approved)', async () => {
    videoStatus = 'approved'
    const res = await request('PATCH', 'in_review', { autoOpen: true })
    assert.equal(((await res.json()) as { status: string }).status, 'approved')
    assert.equal(videoUpdates().length, 0)
    assert.equal(auditInserts().length, 0)
  })

  it('losing the concurrent race (conditional update matches 0 rows): no audit row', async () => {
    videoStatus = 'pending_review'
    raceLost = true
    const res = await request('PATCH', 'in_review', { autoOpen: true })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { id: VIDEO, changed: false })
    assert.equal(videoUpdates().length, 1)
    assert.equal(auditInserts().length, 0)
  })

  it('audit failure reverts the flip (conditionally) and returns 500', async () => {
    videoStatus = 'pending_review'
    auditFails = true
    const res = await request('PATCH', 'in_review', { autoOpen: true })
    assert.equal(res.status, 500)
    const ups = videoUpdates()
    assert.equal(ups.length, 2)
    assert.deepEqual((ups[1].body as { status: string }).status, 'pending_review')
    assert.equal(ups[1].url.searchParams.get('status'), 'eq.in_review')
  })

  it('autoOpen with any status other than in_review is a 400', async () => {
    videoStatus = 'pending_review'
    const res = await request('PATCH', 'approved', { autoOpen: true })
    assert.equal(res.status, 400)
    assert.equal(videoUpdates().length, 0)
  })

  it('is rate limited like every other PATCH', async () => {
    redisCount = 10_000
    const res = await request('PATCH', 'in_review', { autoOpen: true })
    assert.equal(res.status, 429)
    assert.ok(res.headers.get('retry-after'))
  })

  it('audit fails AND revert fails: logs CRITICAL orphan and returns an accurate 500', async () => {
    videoStatus = 'pending_review'
    auditFails = true
    revertFails = true
    const logged: unknown[][] = []
    const realError = console.error
    console.error = (...a: unknown[]) => void logged.push(a)
    let res: Response
    try {
      res = await request('PATCH', 'in_review', { autoOpen: true })
    } finally {
      console.error = realError
    }
    assert.equal(res.status, 500)
    assert.match(((await res.json()) as { error: string }).error, /may have changed/)
    assert.ok(
      logged.some(
        (a) =>
          String(a[0]).includes('CRITICAL: auto-open unaudited flip not reverted') &&
          (a[1] as { videoId: string }).videoId === VIDEO
      )
    )
    assert.equal(videoUpdates()[1].url.searchParams.get('status'), 'eq.in_review')
  })

  it('cross-agency agent sending autoOpen is refused: 403, no update, no audit', async () => {
    membershipAgency = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    videoStatus = 'pending_review'
    const res = await request('PATCH', 'in_review', { autoOpen: true })
    assert.equal(res.status, 403)
    assert.equal(videoUpdates().length, 0)
    assert.equal(auditInserts().length, 0)
  })

  it('non-boolean autoOpen ("true") is treated as a MANUAL change: audit-first, no trigger tag', async () => {
    videoStatus = 'pending_review'
    const res = await request('PATCH', 'in_review', { autoOpen: 'true' })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { id: VIDEO, status: 'in_review' })
    assert.equal(auditInserts().length, 1)
    assert.equal(
      (auditInserts()[0].body as { metadata: { trigger?: string } }).metadata.trigger,
      undefined
    )
  })
})
