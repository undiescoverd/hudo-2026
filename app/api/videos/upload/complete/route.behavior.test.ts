/**
 * Behavioural tests for POST /api/videos/upload/complete (S5-FLOW-003).
 *
 * The real handler runs end to end with Supabase REST/Auth and Upstash stubbed at the fetch
 * layer, R2 stubbed at S3Client.send, and the Next request scope (cookies()) supplied via
 * AsyncLocalStorage — the same approach as the status route behaviour test.
 *
 * Run: pnpm exec tsx app/api/videos/upload/complete/route.behavior.test.ts
 */

import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import { afterEach, before, describe, it } from 'node:test'

const SB = 'https://sb.upload-complete.test'
const REDIS = 'https://redis.upload-complete.test'
const AGENCY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER = '11111111-1111-4111-8111-111111111111'
const OTHER_AGENCY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const AGENT = '44444444-4444-4444-8444-444444444444'
const VIDEO = '22222222-2222-4222-8222-222222222222'
const NEW_VERSION = '55555555-5555-4555-8555-555555555555'
const realFetch = globalThis.fetch

type Call = { method: string; url: URL; body: unknown }

let calls: Call[] = []
let role = 'talent'
// Per-agency roles; any agency not listed means the caller is not a member there.
let roleByAgency: Record<string, string> | null = null
// Status when the route first loads the video vs. when it re-reads it before the flip.
let initialStatus = 'approved'
let freshStatus = 'approved'
let talentOwnerId = USER
// Simulates losing the conditional-update race: no row still matches the guarded status.
let raceLost = false
let auditFails = false
let revertFails = false
let revertMatchesNothing = false
let revertSeen = false
let redisCount = 1

let POST: (req: NextRequest) => Promise<Response>
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
        email: 'talent@upload-complete.test',
        app_metadata: {},
        user_metadata: { full_name: 'Tia Talent' },
        created_at: new Date().toISOString(),
      })
    }
    if (url.pathname === '/rest/v1/rpc/increment_storage_usage') return json(200, null)
    if (url.pathname === '/rest/v1/rpc/create_video_version') return json(200, NEW_VERSION)
    if (url.pathname === '/rest/v1/memberships') {
      // Notification fan-out lists the OTHER members of the agency (neq uploader).
      if (url.searchParams.has('agency_id') && url.searchParams.get('user_id')?.startsWith('neq.'))
        return rows([
          { user_id: AGENT, role: 'agent' },
          { user_id: '66666666-6666-4666-8666-666666666666', role: 'talent' },
        ])
      const wanted = url.searchParams.get('agency_id')?.replace(/^eq\./, '')
      if (roleByAgency && wanted) {
        return rows(roleByAgency[wanted] ? [{ role: roleByAgency[wanted] }] : [])
      }
      return rows([{ role }])
    }
    if (url.pathname === '/rest/v1/videos' && method === 'GET') {
      // The top-of-route read selects talent_id; the pre-flip re-read selects status only.
      const isFreshRead = url.searchParams.get('select') === 'status'
      return rows([
        isFreshRead
          ? { status: revertSeen ? 'in_review' : freshStatus }
          : {
              id: VIDEO,
              agency_id: url.searchParams.get('agency_id')?.replace(/^eq\./, '') ?? AGENCY,
              talent_id: talentOwnerId,
              status: initialStatus,
            },
      ])
    }
    if (url.pathname === '/rest/v1/videos' && method === 'PATCH') {
      const wantsRows = new Headers(init.headers).get('prefer')?.includes('return=representation')
      if (revertFails && url.searchParams.get('status') === 'eq.pending_review')
        return json(500, { message: 'revert down' })
      if (!wantsRows) return new Response(null, { status: 204 })
      if (revertMatchesNothing && url.searchParams.get('status') === 'eq.pending_review') {
        revertSeen = true
        return json(200, [])
      }
      return json(200, raceLost ? [] : [{ id: VIDEO }])
    }
    if (url.pathname === '/rest/v1/audit_log' && method === 'POST') {
      const action = (body as { action?: string } | undefined)?.action
      return auditFails && action === 'status_changed'
        ? json(500, { message: 'audit down' })
        : json(201, [])
    }
    if (url.pathname === '/rest/v1/notifications' && method === 'POST') return json(201, [])
    return json(404, { message: `unexpected ${method} ${url.pathname}` })
  }) as typeof fetch
}

const flipAudits = () =>
  calls.filter(
    (c) =>
      c.url.pathname === '/rest/v1/audit_log' &&
      c.method === 'POST' &&
      (c.body as { action?: string }).action === 'status_changed'
  )
const videoUpdates = () =>
  calls.filter((c) => c.url.pathname === '/rest/v1/videos' && c.method === 'PATCH')
const notificationInserts = () =>
  calls.filter((c) => c.url.pathname === '/rest/v1/notifications' && c.method === 'POST')

async function complete(agencyId: string = AGENCY) {
  calls = []
  installFetch()
  const req = new Request('http://localhost:3000/api/videos/upload/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      videoId: VIDEO,
      agencyId,
      r2Key: `${agencyId}/${VIDEO}/upload.mp4`,
      fileSizeBytes: 1000,
    }),
  }) as unknown as NextRequest
  return runInScope(() => POST(req))
}

async function quietly<T>(fn: () => Promise<T>): Promise<{ result: T; logged: unknown[][] }> {
  const logged: unknown[][] = []
  const realError = console.error
  console.error = (...a: unknown[]) => void logged.push(a)
  try {
    return { result: await fn(), logged }
  } finally {
    console.error = realError
  }
}

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SB
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-upload-complete-test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-upload-complete-test'
  process.env.UPSTASH_REDIS_REST_URL = REDIS
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-upload-complete-test'
  process.env.R2_ACCESS_KEY_ID = 'r2-key'
  process.env.R2_SECRET_ACCESS_KEY = 'r2-secret'
  process.env.R2_ACCOUNT_ID = 'r2-account'
  process.env.R2_BUCKET_NAME = 'r2-bucket'
  // R2: every HeadObject finds a 1000-byte object.
  const { S3Client } = await import('@aws-sdk/client-s3')
  ;(S3Client.prototype as unknown as { send: () => Promise<unknown> }).send = async () => ({
    ContentLength: 1000,
  })
  const { AsyncLocalStorage } = await import('node:async_hooks')
  ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
  const { requestAsyncStorage } =
    await import('next/dist/client/components/request-async-storage.external')
  const session = {
    access_token: 'access-upload-complete-test',
    refresh_token: 'refresh-upload-complete-test',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: USER, aud: 'authenticated' },
  }
  const cookieList = [{ name: 'sb-sb-auth-token', value: JSON.stringify(session) }]
  const cookies = { getAll: () => cookieList, set: () => {}, get: () => undefined }
  runInScope = (fn) =>
    requestAsyncStorage.run({ cookies, mutableCookies: cookies } as never, fn) as Promise<never>
  ;({ POST } = await import('./route'))
})

afterEach(() => {
  globalThis.fetch = realFetch
  role = 'talent'
  roleByAgency = null
  initialStatus = 'approved'
  freshStatus = 'approved'
  talentOwnerId = USER
  raceLost = false
  auditFails = false
  revertFails = false
  revertMatchesNothing = false
  revertSeen = false
  redisCount = 1
})

describe('upload complete — talent new version on Approved (S5-FLOW-003)', () => {
  it('approved -> pending_review: conditional update, one tagged audit row, agents notified', async () => {
    const res = await complete()
    assert.equal(res.status, 200)
    const json = (await res.json()) as { version: string; status: string }
    assert.equal(json.version, NEW_VERSION)
    assert.equal(json.status, 'pending_review')

    assert.equal(videoUpdates().length, 1)
    assert.equal(videoUpdates()[0].url.searchParams.get('status'), 'eq.approved')
    assert.equal((videoUpdates()[0].body as { status: string }).status, 'pending_review')

    assert.equal(flipAudits().length, 1)
    assert.deepEqual((flipAudits()[0].body as { metadata: unknown }).metadata, {
      old_status: 'approved',
      new_status: 'pending_review',
      trigger: 'talent_new_version',
    })

    const notes = notificationInserts()
    assert.equal(notes.length, 1, 'the agent upload alert fires')
    const recipients = (notes[0].body as { recipient_id: string }[]).map((n) => n.recipient_id)
    assert.deepEqual(recipients, [AGENT], 'agents only, never other talent')
  })

  it('uses the FRESH status, not the stale top-of-route read, for the guard and audit', async () => {
    initialStatus = 'draft'
    freshStatus = 'approved'
    await complete()
    assert.equal(videoUpdates()[0].url.searchParams.get('status'), 'eq.approved')
    assert.equal(
      (flipAudits()[0].body as { metadata: { old_status: string } }).metadata.old_status,
      'approved'
    )
  })

  it('changes_requested still flips (no regression)', async () => {
    initialStatus = freshStatus = 'changes_requested'
    const res = await complete()
    assert.equal(((await res.json()) as { status: string }).status, 'pending_review')
    assert.equal(videoUpdates()[0].url.searchParams.get('status'), 'eq.changes_requested')
    assert.equal(flipAudits().length, 1)
    assert.equal(notificationInserts().length, 1)
  })

  it('draft still flips (no regression)', async () => {
    initialStatus = freshStatus = 'draft'
    const res = await complete()
    assert.equal(((await res.json()) as { status: string }).status, 'pending_review')
    assert.equal(flipAudits().length, 1)
    assert.equal(notificationInserts().length, 1)
  })

  for (const status of ['pending_review', 'in_review']) {
    it(`${status} is left as it is: no update, no flip audit, no notification`, async () => {
      initialStatus = freshStatus = status
      const res = await complete()
      assert.equal(res.status, 200)
      assert.equal(((await res.json()) as { status: string }).status, status)
      assert.equal(videoUpdates().length, 0)
      assert.equal(flipAudits().length, 0)
      assert.equal(notificationInserts().length, 0)
    })
  }

  for (const r of ['agent', 'admin_agent', 'owner']) {
    it(`${r} cannot complete an upload (S5-NAV-006): 403, no side effects`, async () => {
      role = r
      const res = await complete()
      assert.equal(res.status, 403)
      assert.match(((await res.json()) as { error: string }).error, /Only talent/)
      assert.equal(calls.filter((c) => c.url.pathname.startsWith('/rest/v1/rpc/')).length, 0)
      assert.equal(videoUpdates().length, 0)
      assert.equal(flipAudits().length, 0)
      assert.equal(notificationInserts().length, 0)
    })
  }

  it('a non-member of the agency is rejected', async () => {
    roleByAgency = {}
    const res = await complete()
    assert.equal(res.status, 403)
  })

  it('mixed roles: agent at A is rejected for A, but the same user as talent at B is allowed for B', async () => {
    roleByAgency = { [AGENCY]: 'agent', [OTHER_AGENCY]: 'talent' }
    const denied = await complete(AGENCY)
    assert.equal(denied.status, 403)
    assert.equal(calls.filter((c) => c.url.pathname.startsWith('/rest/v1/rpc/')).length, 0)

    const allowed = await complete(OTHER_AGENCY)
    assert.equal(allowed.status, 200)
  })

  it('lost race (conditional update matches 0 rows): no flip audit, no notification, still 200', async () => {
    raceLost = true
    const { result: res } = await quietly(complete)
    assert.equal(res.status, 200)
    const json = (await res.json()) as { version: string; status: string }
    assert.equal(json.version, NEW_VERSION)
    assert.equal(json.status, 'approved', 'does not claim a flip it did not win')
    assert.equal(videoUpdates().length, 1)
    assert.equal(flipAudits().length, 0)
    assert.equal(notificationInserts().length, 0)
  })

  it('audit failure reverts the flip conditionally, sends no notification, upload still 200', async () => {
    auditFails = true
    const { result: res } = await quietly(complete)
    assert.equal(res.status, 200)
    assert.equal(((await res.json()) as { status: string }).status, 'approved')
    const ups = videoUpdates()
    assert.equal(ups.length, 2)
    assert.equal((ups[1].body as { status: string }).status, 'approved')
    assert.equal(ups[1].url.searchParams.get('status'), 'eq.pending_review')
    assert.equal(notificationInserts().length, 0)
  })

  it('audit failure AND revert failure: logs CRITICAL and reports the real status', async () => {
    auditFails = true
    revertFails = true
    const { result: res, logged } = await quietly(complete)
    assert.equal(res.status, 200)
    assert.equal(((await res.json()) as { status: string }).status, 'pending_review')
    assert.ok(logged.some((a) => String(a[0]).includes('CRITICAL: unaudited auto-flip')))
    assert.equal(notificationInserts().length, 0)
  })

  it('audit failure and the revert matches 0 rows: warns unaudited and reports the real status', async () => {
    auditFails = true
    revertMatchesNothing = true
    const warned: unknown[][] = []
    const realWarn = console.warn
    console.warn = (...a: unknown[]) => void warned.push(a)
    let res: Response
    try {
      res = (await quietly(complete)).result
    } finally {
      console.warn = realWarn
    }
    assert.equal(res.status, 200)
    assert.equal(((await res.json()) as { status: string }).status, 'in_review')
    assert.ok(warned.some((a) => String(a[0]).includes('revert matched 0 rows')))
    assert.equal(notificationInserts().length, 0)
  })

  it("talent cannot complete an upload on someone else's video: 403, nothing written", async () => {
    talentOwnerId = '99999999-9999-4999-8999-999999999999'
    const res = await complete()
    assert.equal(res.status, 403)
    assert.equal(videoUpdates().length, 0)
    assert.equal(flipAudits().length, 0)
    assert.equal(calls.filter((c) => c.url.pathname.includes('create_video_version')).length, 0)
  })

  it('rate limited: 429 with Retry-After, nothing written', async () => {
    redisCount = 10_000
    const res = await complete()
    assert.equal(res.status, 429)
    assert.ok(res.headers.get('retry-after'))
    assert.equal(videoUpdates().length, 0)
    assert.equal(flipAudits().length, 0)
  })
})
