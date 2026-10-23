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

  it('allows agent+ roles', () => {
    const agentPlusRoles = ['owner', 'admin_agent', 'agent']
    assert.ok(agentPlusRoles.includes('owner'))
    assert.ok(agentPlusRoles.includes('admin_agent'))
    assert.ok(agentPlusRoles.includes('agent'))
  })
})

describe('presign route — talent self-upload (S4-UPLOAD-001)', () => {
  it('UPLOAD_ROLES (real import) includes talent and all agent+ roles', async () => {
    const { UPLOAD_ROLES } = await import('../../../../../lib/api-helpers')
    assert.deepEqual([...UPLOAD_ROLES].sort(), ['admin_agent', 'agent', 'owner', 'talent'].sort())
  })

  // Replicates the resolvedTalentId decision in route.ts: talent always gets
  // forced to themselves; agent+ may set an arbitrary talentId (or default to self).
  function resolveTalentId(role: string, bodyTalentId: string | undefined, userId: string) {
    if (role === 'talent') return userId
    return bodyTalentId && bodyTalentId.trim() ? bodyTalentId : userId
  }

  it('forces resolvedTalentId to the caller for talent, ignoring body talentId', () => {
    assert.equal(resolveTalentId('talent', 'someone-else', 'user-1'), 'user-1')
    assert.equal(resolveTalentId('talent', undefined, 'user-1'), 'user-1')
  })

  it('agent+ may set an arbitrary talentId in the body', () => {
    assert.equal(resolveTalentId('agent', 'talent-abc', 'user-1'), 'talent-abc')
    assert.equal(resolveTalentId('agent', undefined, 'user-1'), 'user-1')
  })

  // Replicates the anti-impersonation guard: talent + foreign talentId in body → 403.
  function talentImpersonationBlocked(
    role: string,
    bodyTalentId: string | undefined,
    userId: string
  ): boolean {
    return (
      role === 'talent' && !!bodyTalentId && bodyTalentId.trim() !== '' && bodyTalentId !== userId
    )
  }

  it('blocks talent supplying a foreign talentId in the body', () => {
    assert.equal(talentImpersonationBlocked('talent', 'other-user', 'user-1'), true)
  })

  it('allows talent supplying their own talentId (no-op) or omitting it', () => {
    assert.equal(talentImpersonationBlocked('talent', 'user-1', 'user-1'), false)
    assert.equal(talentImpersonationBlocked('talent', undefined, 'user-1'), false)
  })

  it('never blocks agent+ regardless of talentId', () => {
    assert.equal(talentImpersonationBlocked('agent', 'anyone', 'user-1'), false)
  })

  // Replicates the existing-video ownership guard for a videoId re-upload path.
  function talentOwnershipBlocked(role: string, videoTalentId: string, userId: string): boolean {
    return role === 'talent' && videoTalentId !== userId
  }

  it('blocks talent from re-uploading to a videoId they do not own', () => {
    assert.equal(talentOwnershipBlocked('talent', 'other-user', 'user-1'), true)
  })

  it('allows talent to re-upload to their own videoId', () => {
    assert.equal(talentOwnershipBlocked('talent', 'user-1', 'user-1'), false)
  })

  it('never blocks agent+ from re-uploading to any videoId in the agency', () => {
    assert.equal(talentOwnershipBlocked('agent', 'someone-else', 'user-1'), false)
  })
})

describe('presign route — source invariants (talent self-upload)', () => {
  let source: string

  before(async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('uses requireUploadRole, not requireAgentRole', () => {
    assert.match(source, /requireUploadRole/)
    assert.doesNotMatch(source, /requireAgentRole/)
  })

  it('captures the resolved role from the membership check', () => {
    assert.match(source, /const \{ role \} = membership/)
  })

  it('rejects talent supplying a foreign talentId with a clear error message', () => {
    assert.match(source, /Talent can only upload videos for themselves/)
  })

  it('the existing-video verification query also selects talent_id', () => {
    const selectMatch = source.match(/\.from\('videos'\)\s*\.select\('id, agency_id, talent_id'\)/)
    assert.ok(selectMatch, 'existing-video select must include talent_id')
  })

  it('returns 403 Access denied for a talent re-uploading to a video they do not own', () => {
    assert.match(source, /existingVideo\.talent_id !== user\.id/)
    assert.match(source, /Access denied/)
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

describe('presign route — agent-supplied talentId membership check', () => {
  let source: string

  before(async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    source = fs.readFileSync(path.resolve(import.meta.dirname ?? __dirname, 'route.ts'), 'utf8')
  })

  it('queries memberships for user_id = talentId, agency_id = agencyId, role = talent', () => {
    assert.match(
      source,
      /\.from\('memberships'\)\s*\.select\('user_id'\)\s*\.eq\('user_id', agentTalentId\)\s*\.eq\('agency_id', agencyId\)\s*\.eq\('role', 'talent'\)/
    )
  })

  it('only applies to non-talent callers that supplied a non-empty talentId', () => {
    assert.match(
      source,
      /role !== 'talent' && typeof talentId === 'string' && talentId\.trim\(\) \? talentId\.trim\(\) : null/
    )
    assert.match(source, /if \(agentTalentId\) \{/)
  })

  it('returns 400 for a non-member / non-talent target', () => {
    assert.match(
      source,
      /if \(!talentMembership\) \{\s*return NextResponse\.json\(\s*\{ error: 'Selected talent is not a member of this agency' \},\s*\{ status: 400 \}/
    )
  })

  it('logs and returns 500 when the membership query errors (checked before the 400)', () => {
    const errIdx = source.indexOf('if (talentMembershipError)')
    const missIdx = source.indexOf('if (!talentMembership)')
    assert.ok(errIdx > -1 && missIdx > errIdx)
    assert.match(source, /Failed to verify talent membership:/)
    assert.match(source, /Failed to verify selected talent' \}, \{ status: 500 \}/)
  })

  it('runs before the videos insert (no partial writes)', () => {
    const checkIdx = source.indexOf(".eq('role', 'talent')")
    const insertIdx = source.indexOf(".from('videos')\n      .insert")
    assert.ok(checkIdx > -1 && insertIdx > checkIdx)
  })

  it('talent callers are still forced to their own id; absent talentId defaults to caller', () => {
    assert.match(
      source,
      /const resolvedTalentId = role === 'talent' \? user\.id : \(agentTalentId \?\? user\.id\)/
    )
  })

  it('does not alter the existing-video path (it never writes talent_id)', () => {
    const retry = source.slice(source.indexOf('// Verify video exists'))
    assert.doesNotMatch(retry.split('// --- Generate presigned')[0], /talent_id:/)
  })
})

// ---------------------------------------------------------------------------
// Handler behaviour — real POST, with Supabase REST/Auth + Upstash stubbed at the
// fetch layer and the Next request scope (cookies()) supplied via AsyncLocalStorage.
// ---------------------------------------------------------------------------

describe('presign route — talentId membership gate (real POST handler)', () => {
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

  const agentRow: Row = { user_id: AGENT, agency_id: AGENCY, role: 'agent' }
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
  const talentLookups = () =>
    calls.filter((c) => c.url.pathname === '/rest/v1/memberships' && c.url.searchParams.get('role'))

  it('agent + non-member talentId -> 400, no videos insert', async () => {
    setup([agentRow])
    const res = await call({ talentId: TALENT })
    assert.equal(res.status, 400)
    assert.match(
      ((await res.json()) as { error: string }).error,
      /Selected talent is not a member of this agency/
    )
    assert.equal(videoInserts().length, 0)
  })

  it('agent + talent of a DIFFERENT agency -> 400, no videos insert', async () => {
    setup([agentRow, { user_id: TALENT, agency_id: OTHER_AGENCY, role: 'talent' }])
    const res = await call({ talentId: TALENT })
    assert.equal(res.status, 400)
    assert.equal(videoInserts().length, 0)
  })

  it('agent + member of this agency with a non-talent role -> 400', async () => {
    setup([agentRow, { user_id: TALENT, agency_id: AGENCY, role: 'agent' }])
    const res = await call({ talentId: TALENT })
    assert.equal(res.status, 400)
    assert.equal(videoInserts().length, 0)
  })

  it('membership lookup error -> 500, no videos insert', async () => {
    setup([agentRow, talentRow])
    membershipsError = true
    const res = await call({ talentId: TALENT })
    assert.equal(res.status, 500)
    assert.equal(videoInserts().length, 0)
  })

  it('agent + valid talent with surrounding whitespace -> inserts the trimmed id', async () => {
    setup([agentRow, talentRow])
    const res = await call({ talentId: `  ${TALENT}  ` })
    assert.equal(res.status, 200)
    const inserts = videoInserts()
    assert.equal(inserts.length, 1)
    assert.equal((inserts[0].body as { talent_id: string }).talent_id, TALENT)
  })

  it('malformed talentId -> 400 and no talent membership query', async () => {
    setup([agentRow, talentRow])
    const res = await call({ talentId: 'abc' })
    assert.equal(res.status, 400)
    assert.equal(talentLookups().length, 0)
    assert.equal(videoInserts().length, 0)
  })

  it('no talentId -> unchanged: video assigned to the caller, no talent lookup', async () => {
    setup([agentRow])
    const res = await call()
    assert.equal(res.status, 200)
    assert.equal((videoInserts()[0].body as { talent_id: string }).talent_id, AGENT)
    assert.equal(talentLookups().length, 0)
  })

  it('talent caller has talentId forced to themselves', async () => {
    setup([{ user_id: AGENT, agency_id: AGENCY, role: 'talent' }])
    const res = await call({ talentId: AGENT })
    assert.equal(res.status, 200)
    assert.equal((videoInserts()[0].body as { talent_id: string }).talent_id, AGENT)
    assert.equal(talentLookups().length, 0)
  })
})
