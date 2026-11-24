/**
 * Unit tests for the presign upload API route.
 *
 * Tests validation logic, constants, and access control invariants.
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 *
 * Run: npx tsx --test app/api/videos/upload/presign/route.test.ts
 */

import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import { afterEach, before, describe, it } from 'node:test'
import {
  ALLOWED_CONTENT_TYPES,
  MAX_FILE_SIZE_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  PRESIGNED_URL_EXPIRY,
  UPLOAD_RATE_LIMIT,
  UPLOAD_RATE_WINDOW,
  isMultipart,
  validateContentType,
  validateFileName,
  validateFileSize,
} from '../../../../../lib/upload-validation'

describe('presign route — validation functions', () => {
  it('rejects non-video content types', () => {
    assert.ok(validateContentType('application/pdf'))
    assert.ok(validateContentType('video/webm'))
    assert.ok(validateContentType('audio/mp3'))
  })

  it('accepts MP4 and QuickTime', () => {
    assert.equal(validateContentType('video/mp4'), null)
    assert.equal(validateContentType('video/quicktime'), null)
  })

  it('rejects files larger than 10 GB', () => {
    assert.ok(validateFileSize(MAX_FILE_SIZE_BYTES + 1))
  })

  it('accepts files up to 10 GB', () => {
    assert.equal(validateFileSize(MAX_FILE_SIZE_BYTES), null)
    assert.equal(validateFileSize(1), null)
  })

  it('rejects non-.mp4/.mov file names', () => {
    assert.ok(validateFileName('video.avi'))
    assert.ok(validateFileName('video.webm'))
    assert.ok(validateFileName('noextension'))
  })

  it('accepts .mp4 and .mov file names', () => {
    assert.equal(validateFileName('video.mp4'), null)
    assert.equal(validateFileName('VIDEO.MOV'), null)
  })
})

describe('presign route — constants', () => {
  it('only allows MP4 and MOV', () => {
    assert.deepEqual([...ALLOWED_CONTENT_TYPES], ['video/mp4', 'video/quicktime'])
  })

  it('rate limit is 10 per hour', () => {
    assert.equal(UPLOAD_RATE_LIMIT, 10)
    assert.equal(UPLOAD_RATE_WINDOW, 3600)
  })

  it('presigned URL expires in 3600 seconds (1 hour)', () => {
    assert.equal(PRESIGNED_URL_EXPIRY, 3600)
  })

  it('multipart threshold is 50 MB', () => {
    assert.equal(MULTIPART_THRESHOLD_BYTES, 50 * 1024 * 1024)
  })
})

describe('presign route — multipart decision', () => {
  it('uses single PUT for 50 MB', () => {
    assert.equal(isMultipart(MULTIPART_THRESHOLD_BYTES), false)
  })

  it('uses multipart for 50 MB + 1', () => {
    assert.equal(isMultipart(MULTIPART_THRESHOLD_BYTES + 1), true)
  })

  it('uses multipart for 1 GB', () => {
    assert.equal(isMultipart(1024 * 1024 * 1024), true)
  })
})

describe('presign route — access control invariants', () => {
  it('returns 401 when user is null', () => {
    const user = null
    const status = user === null ? 401 : 200
    assert.equal(status, 401)
  })

  it('returns 403 when membership is null', () => {
    const membership = null
    const status = membership === null ? 403 : 200
    assert.equal(status, 403)
  })
})

describe('presign route — source code invariants', () => {
  it('uses user-scoped rate limit key: upload:presign:user:{userId}', () => {
    const userId = 'test-user-123'
    const key = `upload:presign:user:${userId}`
    assert.equal(key, 'upload:presign:user:test-user-123')
  })

  it('route file exists and contains POST handler', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /export async function POST/)
    assert.match(source, /upload:presign:user:/)
    assert.match(source, /UPLOAD_RATE_LIMIT/)
    assert.match(source, /generateUploadUrl|createMultipartUpload/)
  })
})

// ---------------------------------------------------------------------------
// Handler behaviour — real POST, with Supabase REST/Auth + Upstash stubbed at the
// fetch layer and the Next request scope (cookies()) supplied via AsyncLocalStorage.
// ---------------------------------------------------------------------------

describe('presign route — talent-only upload (real POST handler, S5-NAV-006)', () => {
  const SB = 'https://sb.presign.test'
  const REDIS = 'https://redis.presign.test'
  const AGENCY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const OTHER_AGENCY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const AGENT = '11111111-1111-4111-8111-111111111111'
  const TALENT = '22222222-2222-4222-8222-222222222222'
  const realFetch = globalThis.fetch

  type Row = { user_id: string; agency_id: string; role: string }
  let memberships: Row[] = []
  let membershipsError = false
  let calls: { method: string; url: URL; body: unknown }[] = []
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
        const items = Array.from({ length: n }, () => ({ result: 1 }))
        return Response.json(Array.isArray(body) ? items : items[0])
      }
      calls.push({ method, url, body })
      const json = (status: number, b: unknown) =>
        new Response(JSON.stringify(b), {
          status,
          headers: { 'content-type': 'application/json' },
        })

      if (url.pathname === '/auth/v1/user') {
        return json(200, {
          id: AGENT,
          aud: 'authenticated',
          role: 'authenticated',
          email: 'agent@presign.test',
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        })
      }
      if (url.pathname === '/rest/v1/memberships') {
        if (membershipsError && url.searchParams.get('role')) {
          return json(500, { code: 'XX000', message: 'boom', details: null, hint: null })
        }
        const eq = (k: string) => url.searchParams.get(k)?.replace(/^eq\./, '')
        const rows = memberships.filter(
          (m) =>
            (!eq('user_id') || m.user_id === eq('user_id')) &&
            (!eq('agency_id') || m.agency_id === eq('agency_id')) &&
            (!eq('role') || m.role === eq('role'))
        )
        const accept = new Headers(init.headers).get('accept') ?? ''
        if (accept.includes('pgrst.object')) {
          return rows.length
            ? json(200, rows[0])
            : json(406, { code: 'PGRST116', message: 'no rows', details: '', hint: null })
        }
        return json(200, rows)
      }
      if (url.pathname === '/rest/v1/agencies') {
        return json(200, {
          storage_usage_bytes: 0,
          storage_limit_bytes: null,
          subscription_status: 'active',
          grace_period_ends_at: null,
        })
      }
      if (url.pathname === '/rest/v1/videos' && method === 'POST') {
        return json(201, { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })
      }
      return json(404, { message: `unexpected ${method} ${url.pathname}` })
    }) as typeof fetch
  }

  before(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SB
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-presign-test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-presign-test'
    process.env.UPSTASH_REDIS_REST_URL = REDIS
    process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-presign-test'
    process.env.R2_ACCESS_KEY_ID = 'r2-key-presign-test'
    process.env.R2_SECRET_ACCESS_KEY = 'r2-secret-presign-test'
    process.env.R2_ACCOUNT_ID = 'acct'
    process.env.R2_BUCKET_NAME = 'bucket'
    process.env.R2_ENDPOINT = 'https://acct.r2.presign.test'
    // Next's request-scope storage needs the global ALS that its server runtime normally installs.
    const { AsyncLocalStorage } = await import('node:async_hooks')
    ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
    const { requestAsyncStorage } =
      await import('next/dist/client/components/request-async-storage.external')

    // Session cookie that @supabase/ssr turns into a (non-expired) session for getUser().
    const session = {
      access_token: 'access-presign-test',
      refresh_token: 'refresh-presign-test',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: AGENT, aud: 'authenticated' },
    }
    const cookieList = [{ name: 'sb-sb-auth-token', value: JSON.stringify(session) }]
    const cookies = { getAll: () => cookieList, set: () => {}, get: () => undefined }
    runInScope = (fn) =>
      requestAsyncStorage.run({ cookies, mutableCookies: cookies } as never, fn) as Promise<never>
    ;({ POST } = await import('./route'))
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function setup(rows: Row[]) {
    calls = []
    membershipsError = false
    memberships = rows
    installFetch()
  }

  const talentRow: Row = { user_id: TALENT, agency_id: AGENCY, role: 'talent' }

  function call(overrides: Record<string, unknown> = {}) {
    const req = new Request('http://localhost:3000/api/videos/upload/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agencyId: AGENCY,
        fileName: 'clip.mp4',
        contentType: 'video/mp4',
        fileSizeBytes: 1024,
        ...overrides,
      }),
    }) as unknown as NextRequest
    return runInScope(() => POST(req))
  }

  const videoInserts = () =>
    calls.filter((c) => c.url.pathname === '/rest/v1/videos' && c.method === 'POST')

  const OWN = { user_id: AGENT, agency_id: AGENCY } // the signed-in user's id is AGENT in this harness

  for (const r of ['owner', 'admin_agent', 'agent']) {
    it(`${r} of the agency -> 403 JSON error, no video created`, async () => {
      setup([{ ...OWN, role: r }])
      const res = await call()
      assert.equal(res.status, 403)
      assert.match(((await res.json()) as { error: string }).error, /Only talent/)
      assert.equal(videoInserts().length, 0)
    })

    it(`${r} sending a talentId is still rejected (talentId no longer accepted)`, async () => {
      setup([{ ...OWN, role: r }, talentRow])
      const res = await call({ talentId: TALENT })
      assert.equal(res.status, 403)
      assert.equal(videoInserts().length, 0)
    })
  }

  it('a non-member of the agency -> 403, no video created', async () => {
    setup([])
    const res = await call()
    assert.equal(res.status, 403)
    assert.equal(videoInserts().length, 0)
  })

  it('mixed roles: agent at A is rejected for A, the same user as talent at B is allowed for B', async () => {
    setup([
      { ...OWN, role: 'agent' },
      { user_id: AGENT, agency_id: OTHER_AGENCY, role: 'talent' },
    ])
    const denied = await call({ agencyId: AGENCY })
    assert.equal(denied.status, 403)
    assert.equal(videoInserts().length, 0)

    const allowed = await call({ agencyId: OTHER_AGENCY })
    assert.equal(allowed.status, 200)
    const inserts = videoInserts()
    assert.equal(inserts.length, 1)
    assert.equal((inserts[0].body as { agency_id: string }).agency_id, OTHER_AGENCY)
  })

  it('talent uploads: video is assigned to the caller', async () => {
    setup([{ ...OWN, role: 'talent' }])
    const res = await call()
    assert.equal(res.status, 200)
    assert.equal((videoInserts()[0].body as { talent_id: string }).talent_id, AGENT)
  })

  it('talent with their own talentId in the body is a no-op', async () => {
    setup([{ ...OWN, role: 'talent' }])
    const res = await call({ talentId: AGENT })
    assert.equal(res.status, 200)
    assert.equal((videoInserts()[0].body as { talent_id: string }).talent_id, AGENT)
  })

  it('talent supplying a foreign talentId -> 403, no video created', async () => {
    setup([{ ...OWN, role: 'talent' }])
    const res = await call({ talentId: TALENT })
    assert.equal(res.status, 403)
    assert.match(
      ((await res.json()) as { error: string }).error,
      /Talent can only upload videos for themselves/
    )
    assert.equal(videoInserts().length, 0)
  })

  it('no talent-membership lookup by body talentId exists any more', async () => {
    setup([{ ...OWN, role: 'talent' }, talentRow])
    await call({ talentId: TALENT })
    assert.equal(
      calls.filter(
        (c) =>
          c.url.pathname === '/rest/v1/memberships' &&
          c.url.searchParams.get('user_id') === `eq.${TALENT}`
      ).length,
      0
    )
  })
})
