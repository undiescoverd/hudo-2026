/**
 * GET ?earlierOpen=1 (S5-FLOW-004): the real handler runs end to end with Supabase
 * REST/Auth + Upstash stubbed at the fetch layer. Counts unresolved, non-deleted,
 * top-level comments on EARLIER versions only.
 *
 * Run: pnpm exec tsx 'app/api/videos/[videoId]/versions/[versionId]/comments/earlier-open.test.ts'
 */

import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import { afterEach, before, describe, it } from 'node:test'

describe('comments GET ?earlierOpen=1 (real handler)', () => {
  const SB = 'https://sb.comments-earlier.test'
  const REDIS = 'https://redis.comments-earlier.test'
  const AGENCY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const USER = '11111111-1111-4111-8111-111111111111'
  const OWNER = '99999999-9999-4999-8999-999999999999'
  const VIDEO = '22222222-2222-4222-8222-222222222222'
  const V1 = '33333333-3333-4333-8333-000000000001'
  const V2 = '33333333-3333-4333-8333-000000000002'
  const V3 = '33333333-3333-4333-8333-000000000003'
  const realFetch = globalThis.fetch

  type C = {
    video_version_id: string
    resolved: boolean
    deleted_at: string | null
    parent_id: string | null
  }
  const c = (v: string, over: Partial<C> = {}): C => ({
    video_version_id: v,
    resolved: false,
    deleted_at: null,
    parent_id: null,
    ...over,
  })

  let role = 'agent'
  let videoTalent = USER
  let hasMembership = true
  let comments: C[] = []
  let calls: URL[] = []
  let GET: (
    req: NextRequest,
    ctx: { params: { videoId: string; versionId: string } }
  ) => Promise<Response>
  let runInScope: <T>(fn: () => Promise<T>) => Promise<T>

  function installFetch() {
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      if (url.origin === REDIS) {
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        return Response.json(Array.isArray(body) ? body.map(() => ({ result: 1 })) : { result: 1 })
      }
      calls.push(url)
      const json = (status: number, b: unknown) =>
        new Response(JSON.stringify(b), {
          status,
          headers: { 'content-type': 'application/json' },
        })
      const eq = (k: string) => url.searchParams.get(k)?.replace(/^eq\./, '')
      const single = (rows: unknown[]) =>
        rows.length
          ? json(200, rows[0])
          : json(406, { code: 'PGRST116', message: 'no rows', details: '', hint: null })
      const isSingle = new Headers(init.headers).get('accept')?.includes('pgrst.object')

      if (url.pathname === '/auth/v1/user') {
        return json(200, {
          id: USER,
          aud: 'authenticated',
          role: 'authenticated',
          email: 'a@comments-earlier.test',
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        })
      }
      if (url.pathname === '/rest/v1/videos') {
        return single([{ id: VIDEO, agency_id: AGENCY, talent_id: videoTalent }])
      }
      if (url.pathname === '/rest/v1/memberships') {
        return single(hasMembership ? [{ role }] : [])
      }
      if (url.pathname === '/rest/v1/video_versions') {
        const all = [
          { id: V1, version_number: 1 },
          { id: V2, version_number: 2 },
          { id: V3, version_number: 3 },
        ]
        if (isSingle) return single(all.filter((v) => v.id === eq('id')))
        return json(200, all)
      }
      if (url.pathname === '/rest/v1/comments') {
        // Honour the filters the handler sends, like PostgREST would.
        const inList = (url.searchParams.get('video_version_id') ?? '')
          .replace(/^in\.\(|\)$/g, '')
          .split(',')
        const rows = comments.filter(
          (r) =>
            inList.includes(r.video_version_id) &&
            r.resolved === (url.searchParams.get('resolved') === 'eq.true') &&
            (url.searchParams.get('deleted_at') !== 'is.null' || r.deleted_at === null) &&
            (url.searchParams.get('parent_id') !== 'is.null' || r.parent_id === null)
        )
        return json(
          200,
          rows.map((r) => ({ video_version_id: r.video_version_id }))
        )
      }
      return json(404, { message: `unexpected ${url.pathname}` })
    }) as typeof fetch
  }

  before(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SB
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-comments-earlier-test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-comments-earlier-test'
    process.env.UPSTASH_REDIS_REST_URL = REDIS
    process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-comments-earlier-test'
    const { AsyncLocalStorage } = await import('node:async_hooks')
    ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
    const { requestAsyncStorage } =
      await import('next/dist/client/components/request-async-storage.external')
    const session = {
      access_token: 'access-comments-earlier-test',
      refresh_token: 'refresh-comments-earlier-test',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: USER, aud: 'authenticated' },
    }
    const cookieList = [{ name: 'sb-sb-auth-token', value: JSON.stringify(session) }]
    const cookies = { getAll: () => cookieList, set: () => {}, get: () => undefined }
    runInScope = (fn) =>
      requestAsyncStorage.run({ cookies, mutableCookies: cookies } as never, fn) as Promise<never>
    ;({ GET } = await import('./route'))
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    role = 'agent'
    videoTalent = USER
    hasMembership = true
  })

  function get(versionId: string, qs = '?earlierOpen=1') {
    calls = []
    installFetch()
    const req = new Request(
      `http://localhost:3000/api/videos/${VIDEO}/versions/${versionId}/comments${qs}`
    ) as unknown as NextRequest
    return runInScope(() => GET(req, { params: { videoId: VIDEO, versionId } }))
  }
  const commentQueries = () => calls.filter((u) => u.pathname === '/rest/v1/comments').length

  it('counts only unresolved, non-deleted, top-level comments, one entry per earlier version', async () => {
    comments = [
      c(V1),
      c(V1),
      c(V1, { resolved: true }), // resolved: not counted
      c(V1, { deleted_at: '2026-10-01T00:00:00Z' }), // deleted: not counted
      c(V1, { parent_id: 'x' }), // reply: not counted
      c(V2),
      c(V3), // the viewed version itself: never counted
    ]
    const res = await get(V3)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), {
      earlierOpen: [
        { versionId: V1, versionNumber: 1, openCount: 2 },
        { versionId: V2, versionNumber: 2, openCount: 1 },
      ],
    })
  })

  it('omits earlier versions with no open comments (no note)', async () => {
    comments = [c(V1, { resolved: true }), c(V2, { deleted_at: '2026-10-01T00:00:00Z' })]
    const res = await get(V3)
    assert.deepEqual(await res.json(), { earlierOpen: [] })
  })

  it('the first version has no earlier versions, so no comment query is made', async () => {
    comments = [c(V1), c(V2)]
    const res = await get(V1)
    assert.deepEqual(await res.json(), { earlierOpen: [] })
    assert.equal(commentQueries(), 0)
  })

  it('works for talent on their own video', async () => {
    role = 'talent'
    comments = [c(V1)]
    const res = await get(V2)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), {
      earlierOpen: [{ versionId: V1, versionNumber: 1, openCount: 1 }],
    })
  })

  it("talent on someone else's video -> 403, no counts leaked", async () => {
    role = 'talent'
    videoTalent = OWNER
    comments = [c(V1)]
    const res = await get(V2)
    assert.equal(res.status, 403)
    assert.equal(commentQueries(), 0)
  })

  it('a non-member -> 403, no counts leaked', async () => {
    hasMembership = false
    comments = [c(V1)]
    const res = await get(V2)
    assert.equal(res.status, 403)
    assert.equal(commentQueries(), 0)
  })

  it('without ?earlierOpen the normal comment list shape is unchanged', async () => {
    comments = []
    const res = await get(V2, '')
    assert.equal(res.status, 200)
    const body = (await res.json()) as Record<string, unknown>
    assert.ok('comments' in body)
    assert.ok(!('earlierOpen' in body))
  })
})
