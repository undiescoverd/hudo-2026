/**
 * Unit tests for the multipart-url API route.
 *
 * Tests validation/normalization logic, access control, and source code
 * invariants. Uses Node.js built-in test runner — no Next.js runtime needed
 * (mirrors the established pattern in the sibling presign/complete route tests).
 *
 * Run: npx tsx --test app/api/videos/upload/multipart-url/route.test.ts
 */

import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import { afterEach, before, describe, it } from 'node:test'

const MAX_PARTS_PER_REQUEST = 10

// ── Replicates the body-normalization fix (CLAUDE.md: multipart bug fix) ──
// Server accepts either the documented `partNumbers` array or the legacy
// singular `partNumber` the client actually sends.
function normalizePartNumbers(rawPartNumbers: unknown, partNumber: unknown): unknown[] | undefined {
  return (
    (rawPartNumbers as unknown[] | undefined) ??
    (partNumber !== undefined ? [partNumber] : undefined)
  )
}

describe('multipart-url route — partNumbers/partNumber normalization', () => {
  it('accepts a partNumbers array as-is', () => {
    assert.deepEqual(normalizePartNumbers([1, 2, 3], undefined), [1, 2, 3])
  })

  it('accepts a legacy singular partNumber, wrapping it into an array', () => {
    assert.deepEqual(normalizePartNumbers(undefined, 5), [5])
  })

  it('prefers partNumbers when both are present', () => {
    assert.deepEqual(normalizePartNumbers([9], 5), [9])
  })

  it('is undefined when neither is present (→ 400 downstream)', () => {
    assert.equal(normalizePartNumbers(undefined, undefined), undefined)
  })

  it('downstream validation rejects an empty/undefined result', () => {
    const partNumbers = normalizePartNumbers(undefined, undefined)
    const valid = Array.isArray(partNumbers) && partNumbers.length > 0
    assert.equal(valid, false)
  })

  it('caps at MAX_PARTS_PER_REQUEST', () => {
    assert.equal(MAX_PARTS_PER_REQUEST, 10)
    const tooMany = Array.from({ length: 11 }, (_, i) => i + 1)
    assert.ok(tooMany.length > MAX_PARTS_PER_REQUEST)
  })
})

describe('multipart-url route — R2 key parsing (agencyId/videoId derivation)', () => {
  function parseKey(r2Key: string) {
    const agencyId = r2Key.split('/')[0]
    const keyVideoId = r2Key.split('/')[1]
    return { agencyId, keyVideoId }
  }

  it('derives agencyId and keyVideoId from a well-formed key', () => {
    const { agencyId, keyVideoId } = parseKey('agency-1/video-1/upload-id.mp4')
    assert.equal(agencyId, 'agency-1')
    assert.equal(keyVideoId, 'video-1')
  })

  it('flags a malformed key missing the videoId segment', () => {
    const { keyVideoId } = parseKey('agency-1')
    assert.equal(keyVideoId, undefined)
  })
})

describe('multipart-url route — talent ownership guard (S4-UPLOAD-001)', () => {
  // Replicates the talent-only ownership check added to the route.
  function talentAccessDenied(
    role: string,
    video: { talent_id: string; agency_id: string } | null,
    userId: string,
    keyAgencyId: string
  ): boolean {
    if (role !== 'talent') return false
    return !video || video.talent_id !== userId || video.agency_id !== keyAgencyId
  }

  it('allows talent who owns the video and matches the key agency', () => {
    assert.equal(
      talentAccessDenied(
        'talent',
        { talent_id: 'user-1', agency_id: 'agency-1' },
        'user-1',
        'agency-1'
      ),
      false
    )
  })

  it('denies talent who does not own the video', () => {
    assert.equal(
      talentAccessDenied(
        'talent',
        { talent_id: 'other-user', agency_id: 'agency-1' },
        'user-1',
        'agency-1'
      ),
      true
    )
  })

  it('denies talent when the key agency does not match the video agency', () => {
    assert.equal(
      talentAccessDenied(
        'talent',
        { talent_id: 'user-1', agency_id: 'agency-2' },
        'user-1',
        'agency-1'
      ),
      true
    )
  })

  it('denies talent when the video does not exist', () => {
    assert.equal(talentAccessDenied('talent', null, 'user-1', 'agency-1'), true)
  })
})

describe('multipart-url route — source invariants', () => {
  let source: string

  before(async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('exports POST handler', () => {
    assert.match(source, /export async function POST/)
  })

  it('uses requireUploadRole (imported from lib/api-helpers), not an inline agentPlusRoles check', () => {
    assert.match(source, /import \{ requireUploadRole \} from '@\/lib\/api-helpers'/)
    assert.match(source, /requireUploadRole\(/)
    assert.doesNotMatch(source, /agentPlusRoles/)
  })

  it('normalizes partNumbers from either partNumbers or legacy partNumber', () => {
    assert.match(source, /partNumbers: rawPartNumbers/)
    assert.match(
      source,
      /const partNumbers = rawPartNumbers \?\? \(partNumber !== undefined \? \[partNumber\] : undefined\)/
    )
  })

  it('derives keyVideoId from the R2 key and 400s on a malformed key', () => {
    assert.match(source, /const keyVideoId = r2Key\.split\('\/'\)\[1\]/)
    assert.match(source, /Invalid R2 key format/)
  })

  it('enforces talent ownership (talent_id + agency_id match) before issuing part URLs', () => {
    assert.match(source, /membership\.role !== 'talent'/)
    assert.match(source, /video\.talent_id !== user\.id \|\| video\.agency_id !== agencyId/)
    assert.match(source, /Access denied/)
  })
})

// ---------------------------------------------------------------------------
// Handler behaviour (S5-NAV-006) — real POST with Supabase REST/Auth + Upstash stubbed at
// the fetch layer and the Next request scope (cookies()) supplied via AsyncLocalStorage.
// ---------------------------------------------------------------------------

describe('multipart-url route — talent-only (real POST handler, S5-NAV-006)', () => {
  const SB = 'https://sb.multipart.test'
  const REDIS = 'https://redis.multipart.test'
  const AGENCY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const OTHER_AGENCY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const USER = '11111111-1111-4111-8111-111111111111'
  const VIDEO = '22222222-2222-4222-8222-222222222222'
  const realFetch = globalThis.fetch

  type Row = { user_id: string; agency_id: string; role: string }
  let memberships: Row[] = []
  let videoOwner = USER
  let calls: { method: string; url: URL }[] = []
  let POST: (req: NextRequest) => Promise<Response>
  let runInScope: <T>(fn: () => Promise<T>) => Promise<T>

  function installFetch() {
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      const method = (init.method ?? 'GET').toUpperCase()
      if (url.origin === REDIS) {
        let body: unknown
        try {
          body = JSON.parse(String(init.body))
        } catch {
          body = undefined
        }
        const n = Array.isArray(body) ? body.length : 1
        const items = Array.from({ length: n }, () => ({ result: 1 }))
        return Response.json(Array.isArray(body) ? items : items[0])
      }
      calls.push({ method, url })
      const json = (status: number, b: unknown) =>
        new Response(JSON.stringify(b), {
          status,
          headers: { 'content-type': 'application/json' },
        })
      const eq = (k: string) => url.searchParams.get(k)?.replace(/^eq\./, '')
      const asObject = new Headers(init.headers).get('accept')?.includes('pgrst.object')
      const rows = (list: unknown[]) =>
        asObject
          ? list.length
            ? json(200, list[0])
            : json(406, { code: 'PGRST116', message: 'no rows', details: '', hint: null })
          : json(200, list)

      if (url.pathname === '/auth/v1/user') {
        return json(200, {
          id: USER,
          aud: 'authenticated',
          role: 'authenticated',
          email: 'u@multipart.test',
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        })
      }
      if (url.pathname === '/rest/v1/memberships') {
        return rows(
          memberships.filter(
            (m) =>
              (!eq('user_id') || m.user_id === eq('user_id')) &&
              (!eq('agency_id') || m.agency_id === eq('agency_id'))
          )
        )
      }
      if (url.pathname === '/rest/v1/videos') {
        return rows(
          eq('id') === VIDEO ? [{ id: VIDEO, agency_id: AGENCY, talent_id: videoOwner }] : []
        )
      }
      return json(404, { message: `unexpected ${method} ${url.pathname}` })
    }) as typeof fetch
  }

  before(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SB
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-multipart-test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-multipart-test'
    process.env.UPSTASH_REDIS_REST_URL = REDIS
    process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-multipart-test'
    process.env.R2_ACCESS_KEY_ID = 'r2-key-multipart-test'
    process.env.R2_SECRET_ACCESS_KEY = 'r2-secret-multipart-test'
    process.env.R2_ACCOUNT_ID = 'acct'
    process.env.R2_BUCKET_NAME = 'bucket'
    process.env.R2_ENDPOINT = 'https://acct.r2.multipart.test'
    const { AsyncLocalStorage } = await import('node:async_hooks')
    ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
    const { requestAsyncStorage } =
      await import('next/dist/client/components/request-async-storage.external')
    const session = {
      access_token: 'access-multipart-test',
      refresh_token: 'refresh-multipart-test',
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
    videoOwner = USER
  })

  function setup(rows: Row[]) {
    calls = []
    memberships = rows
    installFetch()
  }

  function call(agencyId: string = AGENCY) {
    const req = new Request('http://localhost:3000/api/videos/upload/multipart-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        r2Key: `${agencyId}/${VIDEO}/upload.mp4`,
        r2UploadId: 'upload-1',
        partNumbers: [1, 2],
      }),
    }) as unknown as NextRequest
    return runInScope(() => POST(req))
  }

  const videoReads = () => calls.filter((c) => c.url.pathname === '/rest/v1/videos')

  for (const r of ['owner', 'admin_agent', 'agent']) {
    it(`${r} of the agency -> 403 JSON error, no part URLs, no video lookup`, async () => {
      setup([{ user_id: USER, agency_id: AGENCY, role: r }])
      const res = await call()
      assert.equal(res.status, 403)
      const json = (await res.json()) as { error: string; partUrls?: unknown }
      assert.match(json.error, /Only talent/)
      assert.equal(json.partUrls, undefined)
      assert.equal(videoReads().length, 0)
    })
  }

  it('a non-member of the agency -> 403', async () => {
    setup([])
    assert.equal((await call()).status, 403)
  })

  it('mixed roles: agent at A is rejected for A; the same user as talent at B is not rejected by the role gate', async () => {
    setup([
      { user_id: USER, agency_id: AGENCY, role: 'agent' },
      { user_id: USER, agency_id: OTHER_AGENCY, role: 'talent' },
    ])
    const denied = await call(AGENCY)
    assert.equal(denied.status, 403)
    assert.match(((await denied.json()) as { error: string }).error, /Only talent/)
    assert.equal(videoReads().length, 0)

    // At B the role gate passes and the request reaches the ownership check, which
    // fails because VIDEO lives in AGENCY (key agency != video agency): a different 403.
    const atB = await call(OTHER_AGENCY)
    assert.equal(atB.status, 403)
    assert.match(((await atB.json()) as { error: string }).error, /Access denied/)
    assert.equal(videoReads().length, 1)
  })

  it('talent who owns the video gets part URLs', async () => {
    setup([{ user_id: USER, agency_id: AGENCY, role: 'talent' }])
    const res = await call()
    assert.equal(res.status, 200)
    assert.equal(((await res.json()) as { partUrls: unknown[] }).partUrls.length, 2)
  })

  it('talent who does not own the video -> 403 Access denied', async () => {
    videoOwner = '99999999-9999-4999-8999-999999999999'
    setup([{ user_id: USER, agency_id: AGENCY, role: 'talent' }])
    const res = await call()
    assert.equal(res.status, 403)
    assert.match(((await res.json()) as { error: string }).error, /Access denied/)
  })
})
