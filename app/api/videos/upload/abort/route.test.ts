/**
 * abort route: real handler with Supabase REST/Auth and Upstash stubbed at the fetch
 * layer, the Next request scope supplied via AsyncLocalStorage, and the storage
 * singleton's abortMultipartUpload spied (same approach as the comments route test).
 *
 * Run: npx tsx --test app/api/videos/upload/abort/route.test.ts
 */
import assert from 'node:assert/strict'
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import type { NextRequest } from 'next/server'

const SB = 'https://sb.upload-abort.test'
const REDIS = 'https://redis.upload-abort.test'
const AGENCY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER = '11111111-1111-4111-8111-111111111111'
const OTHER_USER = '99999999-9999-4999-8999-999999999999'
const VIDEO = '22222222-2222-4222-8222-222222222222'
const KEY = `${AGENCY}/${VIDEO}/abc123.mp4`
const UPLOAD_ID = 'secret-upload-id-xyz'

const realFetch = globalThis.fetch

let signedIn = true
let role: string | null = 'agent'
let videoRow: { id: string; agency_id: string; talent_id: string } | null
let redisCount = 1
let POST: (req: NextRequest) => Promise<Response>
let runInScope: <T>(fn: () => Promise<T>) => Promise<T>
let abortSpy: ReturnType<typeof mock.fn<(key: string, uploadId: string) => Promise<void>>>

const json = (status: number, b: unknown) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.origin === REDIS) {
      // Upstash sends either one command (["incr", key]) or a pipeline ([[...], [...]]).
      const body = JSON.parse(String(init.body)) as unknown[]
      const result = (cmd: unknown) =>
        ({ result: String(cmd).toLowerCase() === 'incr' ? redisCount : 1 }) as const
      return Array.isArray(body[0])
        ? Response.json((body as unknown[][]).map((c) => result(c[0])))
        : Response.json(result(body[0]))
    }
    const eq = (k: string) => url.searchParams.get(k)?.replace(/^eq\./, '')
    const none = () => json(406, { code: 'PGRST116', message: 'no rows', details: '', hint: null })
    if (url.pathname === '/auth/v1/user') {
      return json(200, {
        id: USER,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'a@upload-abort.test',
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      })
    }
    if (url.pathname === '/rest/v1/memberships') {
      return role ? json(200, { role }) : none()
    }
    if (url.pathname === '/rest/v1/videos') {
      return videoRow && eq('id') === videoRow.id && eq('agency_id') === videoRow.agency_id
        ? json(200, videoRow)
        : none()
    }
    return json(404, { message: `unexpected ${url.pathname}` })
  }) as typeof fetch
}

function call(body: unknown) {
  return runInScope(() =>
    POST({ json: async () => body } as unknown as NextRequest)
  ) as Promise<Response>
}

describe('POST /api/videos/upload/abort (real handler)', () => {
  before(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SB
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-upload-abort-test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-upload-abort-test'
    process.env.UPSTASH_REDIS_REST_URL = REDIS
    process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-upload-abort-test'
    process.env.R2_ACCESS_KEY_ID = 'k'
    process.env.R2_SECRET_ACCESS_KEY = 's'
    process.env.R2_ACCOUNT_ID = 'acct'
    process.env.R2_BUCKET_NAME = 'bucket'
    process.env.R2_ENDPOINT = 'https://acct.r2.example.test'

    const { AsyncLocalStorage } = await import('node:async_hooks')
    ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
    const { requestAsyncStorage } =
      await import('next/dist/client/components/request-async-storage.external')
    const session = {
      access_token: 'access-upload-abort-test',
      refresh_token: 'refresh-upload-abort-test',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: USER, aud: 'authenticated' },
    }
    const cookieList = () => [{ name: 'sb-sb-auth-token', value: JSON.stringify(session) }]
    runInScope = (fn) => {
      const cookies = {
        getAll: () => (signedIn ? cookieList() : []),
        set: () => {},
        get: () => undefined,
      }
      return requestAsyncStorage.run({ cookies, mutableCookies: cookies } as never, fn) as never
    }

    const { getStorage } = await import('@/lib/storage')
    abortSpy = mock.method(getStorage(), 'abortMultipartUpload', async () => {}) as never
    ;({ POST } = await import('./route'))
  })

  beforeEach(() => {
    signedIn = true
    role = 'agent'
    videoRow = { id: VIDEO, agency_id: AGENCY, talent_id: OTHER_USER }
    redisCount = 1
    abortSpy.mock.resetCalls()
    abortSpy.mock.mockImplementation(async () => {})
    installFetch()
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  const ok = { r2Key: KEY, r2UploadId: UPLOAD_ID }

  it('(a) no user: 401 and no abort', async () => {
    signedIn = false
    const res = await call(ok)
    assert.equal(res.status, 401)
    assert.equal(abortSpy.mock.callCount(), 0)
  })

  it('(b) no membership: 403 and no abort', async () => {
    role = null
    const res = await call(ok)
    assert.equal(res.status, 403)
    assert.equal(abortSpy.mock.callCount(), 0)
  })

  it('(b) non-upload role: 403 and no abort', async () => {
    role = 'viewer'
    const res = await call(ok)
    assert.equal(res.status, 403)
    assert.equal(abortSpy.mock.callCount(), 0)
  })

  it("(c) talent on another talent's video: 403", async () => {
    role = 'talent'
    videoRow = { id: VIDEO, agency_id: AGENCY, talent_id: OTHER_USER }
    const res = await call(ok)
    assert.equal(res.status, 403)
    assert.equal(abortSpy.mock.callCount(), 0)
  })

  it("(c) video not in the key's agency: 403 (agent too)", async () => {
    videoRow = { id: VIDEO, agency_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', talent_id: USER }
    const res = await call(ok)
    assert.equal(res.status, 403)
    assert.equal(abortSpy.mock.callCount(), 0)
  })

  it('talent on their own video: 200', async () => {
    role = 'talent'
    videoRow = { id: VIDEO, agency_id: AGENCY, talent_id: USER }
    const res = await call(ok)
    assert.equal(res.status, 200)
    assert.equal(abortSpy.mock.callCount(), 1)
  })

  it('(d) agent in the key agency: 200 and abort called with the exact key and uploadId', async () => {
    const res = await call(ok)
    assert.equal(res.status, 200)
    assert.deepEqual(abortSpy.mock.calls[0].arguments, [KEY, UPLOAD_ID])
  })

  it('(e) rate limited: 429 with Retry-After and no abort', async () => {
    redisCount = 9999
    const res = await call(ok)
    assert.equal(res.status, 429)
    assert.ok(res.headers.get('Retry-After'))
    assert.equal(abortSpy.mock.callCount(), 0)
  })

  it('(f) storage throws: 500 and the body leaks neither key nor uploadId', async () => {
    abortSpy.mock.mockImplementation(async () => {
      throw new Error(`NoSuchUpload ${KEY} ${UPLOAD_ID}`)
    })
    const res = await call(ok)
    assert.equal(res.status, 500)
    const text = await res.text()
    assert.ok(!text.includes(UPLOAD_ID))
    assert.ok(!text.includes(KEY))
  })

  it('(g) missing / malformed / oversized input: 400 and no abort', async () => {
    const bad: unknown[] = [
      null,
      {},
      { r2Key: KEY },
      { r2UploadId: UPLOAD_ID },
      { r2Key: 'no-slashes', r2UploadId: UPLOAD_ID },
      { r2Key: `not-a-uuid/${VIDEO}/x.mp4`, r2UploadId: UPLOAD_ID },
      { r2Key: `${AGENCY}/not-a-uuid/x.mp4`, r2UploadId: UPLOAD_ID },
      { r2Key: `${AGENCY}/${VIDEO}/${'a'.repeat(600)}`, r2UploadId: UPLOAD_ID },
      { r2Key: KEY, r2UploadId: 'u'.repeat(2000) },
    ]
    for (const body of bad) {
      const res = await call(body)
      assert.equal(res.status, 400, JSON.stringify(body)?.slice(0, 80))
    }
    assert.equal(abortSpy.mock.callCount(), 0)
  })
})
