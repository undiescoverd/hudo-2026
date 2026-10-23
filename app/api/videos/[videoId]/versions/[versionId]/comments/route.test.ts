/**
 * Unit tests for the comments collection API route.
 *
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 * Tests validation logic and source-invariant security checks, plus the real POST
 * handler end to end (reply depth guard) with Supabase and Upstash stubbed at fetch.
 *
 * Run: npx tsx --test "app/api/videos/[videoId]/versions/[versionId]/comments/route.test.ts"
 */

import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import { afterEach, before, describe, it, mock } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

// ---------------------------------------------------------------------------
// UUID validation (mirrors the shared isValidUUID/UUID_RE in lib/validation.ts,
// which route.ts now uses instead of a local copy)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('comments collection route — UUID validation', () => {
  it('accepts a valid UUID', () => {
    assert.ok(UUID_RE.test('a1b2c3d4-e5f6-7890-abcd-ef1234567890'))
  })

  it('rejects a malformed UUID', () => {
    assert.ok(!UUID_RE.test('not-a-uuid'))
  })

  it('rejects SQL injection', () => {
    assert.ok(!UUID_RE.test("'; DROP TABLE comments; --"))
  })

  it('rejects an empty string', () => {
    assert.ok(!UUID_RE.test(''))
  })
})

// ---------------------------------------------------------------------------
// validateCreateInput (imported from lib/comments — pure logic, no Next.js)
// ---------------------------------------------------------------------------

describe('validateCreateInput', () => {
  let validateCreateInput: (body: unknown) => unknown

  before(async () => {
    const mod = await import('@/lib/comments')
    validateCreateInput = mod.validateCreateInput
  })

  it('accepts a valid point comment', () => {
    const result = validateCreateInput({
      content: 'Great take!',
      comment_type: 'point',
      timestamp_seconds: 12.5,
    })
    assert.ok(typeof result !== 'string', `Expected success, got error: ${result}`)
  })

  it('accepts a valid range comment with end_timestamp_seconds', () => {
    const result = validateCreateInput({
      content: 'This section needs work.',
      comment_type: 'range',
      timestamp_seconds: 5,
      end_timestamp_seconds: 10,
    })
    assert.ok(typeof result !== 'string', `Expected success, got error: ${result}`)
  })

  it('rejects missing content', () => {
    const result = validateCreateInput({ comment_type: 'point', timestamp_seconds: 1 })
    assert.equal(typeof result, 'string')
  })

  it('rejects empty content', () => {
    const result = validateCreateInput({
      content: '   ',
      comment_type: 'point',
      timestamp_seconds: 1,
    })
    assert.equal(typeof result, 'string')
  })

  it('rejects content exceeding 2000 characters', () => {
    const result = validateCreateInput({
      content: 'x'.repeat(2001),
      comment_type: 'point',
      timestamp_seconds: 1,
    })
    assert.equal(typeof result, 'string')
    assert.match(result as string, /2000/)
  })

  it('accepts content of exactly 2000 characters', () => {
    const result = validateCreateInput({
      content: 'x'.repeat(2000),
      comment_type: 'point',
      timestamp_seconds: 1,
    })
    assert.ok(typeof result !== 'string')
  })

  it('rejects invalid comment_type', () => {
    const result = validateCreateInput({
      content: 'hello',
      comment_type: 'invalid',
      timestamp_seconds: 1,
    })
    assert.equal(typeof result, 'string')
    assert.match(result as string, /comment_type/)
  })

  it("rejects comment_type not in ['point', 'range']", () => {
    for (const bad of ['text', 'area', '', 'Point']) {
      const result = validateCreateInput({
        content: 'hello',
        comment_type: bad,
        timestamp_seconds: 1,
      })
      assert.equal(typeof result, 'string', `Expected error for comment_type='${bad}'`)
    }
  })

  it('rejects non-numeric timestamp_seconds', () => {
    const result = validateCreateInput({
      content: 'hello',
      comment_type: 'point',
      timestamp_seconds: 'abc',
    })
    assert.equal(typeof result, 'string')
  })

  it('rejects range comment missing end_timestamp_seconds', () => {
    const result = validateCreateInput({
      content: 'hello',
      comment_type: 'range',
      timestamp_seconds: 5,
    })
    assert.equal(typeof result, 'string')
    assert.match(result as string, /end_timestamp_seconds/)
  })

  it('rejects invalid parent_id format', () => {
    const result = validateCreateInput({
      content: 'hello',
      comment_type: 'point',
      timestamp_seconds: 1,
      parent_id: 'not-a-uuid',
    })
    assert.equal(typeof result, 'string')
    assert.match(result as string, /parent_id/)
  })

  it('accepts a valid parent_id UUID', () => {
    const result = validateCreateInput({
      content: 'hello',
      comment_type: 'point',
      timestamp_seconds: 1,
      parent_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    })
    assert.ok(typeof result !== 'string')
  })
})

// ---------------------------------------------------------------------------
// Source invariants — security-critical patterns in route.ts
// ---------------------------------------------------------------------------

describe('comments collection route — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const routePath = path.resolve(currentDir, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('exports a GET handler', () => {
    assert.match(source, /export async function GET/)
  })

  it('exports a POST handler', () => {
    assert.match(source, /export async function POST/)
  })

  it('enforces authentication (Authentication required)', () => {
    assert.match(source, /Authentication required/)
  })

  it('applies rate limiting for GET with correct key pattern', () => {
    assert.match(source, /comments:get:user:/)
  })

  it('applies rate limiting for POST with correct key pattern', () => {
    assert.match(source, /comments:post:user:/)
  })

  it('fails-closed on Redis error via the shared checkRateLimit helper', () => {
    // The 503 status itself lives in lib/api-helpers.ts (rateLimitFailClosedResponse);
    // route.ts just needs to opt in via the 'fail-closed' mode for both GET and POST.
    const matches = source.match(/'fail-closed'/g) ?? []
    assert.ok(
      matches.length >= 2,
      'Expected at least 2 occurrences of the fail-closed mode (GET + POST)'
    )
    assert.match(source, /from '@\/lib\/api-helpers'/)
  })

  it('filters soft-deleted comments (.is deleted_at null)', () => {
    assert.match(source, /\.is\('deleted_at',\s*null\)/)
  })

  it('embeds the comment author via the disambiguated users FK hint', () => {
    // comments has TWO FKs to users (user_id, resolved_by), so an unhinted
    // `users(...)` embed would error with "more than one relationship was
    // found" — see CLAUDE.md's videos<->video_versions two-FK failure-log
    // entry for the same class of bug.
    assert.match(source, /users!comments_user_id_fkey\(full_name,\s*avatar_url\)/)
  })

  it('orders comments by timestamp_seconds ascending', () => {
    assert.match(source, /order\('timestamp_seconds',\s*\{\s*ascending:\s*true\s*\}/)
  })

  it('POST calls validateCreateInput for body validation', () => {
    assert.match(source, /validateCreateInput/)
  })

  it('imports validateCreateInput from lib/comments', () => {
    assert.match(source, /from '@\/lib\/comments'/)
  })

  it('never calls .delete() on the comments table', () => {
    assert.doesNotMatch(source, /\.delete\(\)/)
  })

  it('uses service role client for DB ops (createAdminClient)', () => {
    assert.match(source, /createAdminClient\(\)/)
  })

  it('uses createSupabaseServerClient for auth', () => {
    assert.match(source, /createSupabaseServerClient/)
  })

  it('serializes responses to camelCase via rowToComment (GET + POST)', () => {
    // The client Comment type and CommentPanel/CommentInput are camelCase;
    // returning raw snake_case rows makes the thread render empty. Both paths
    // must map through rowToComment.
    assert.match(source, /\.map\(rowToComment\)/) // GET list
    assert.match(source, /comment:\s*rowToComment\(comment\)/) // POST echo
  })

  it('reports notification enqueue failures to Sentry (S3-SEC-006)', () => {
    assert.match(source, /import \* as Sentry from '@sentry\/nextjs'/)

    const catchBlock = source.slice(source.indexOf('.catch((err) => {'))
    assert.match(
      catchBlock,
      /Sentry\.captureException\(err/,
      'Swallowed notification-enqueue failure must be reported to Sentry'
    )
  })
})

// ---------------------------------------------------------------------------
// lib/comments constants
// ---------------------------------------------------------------------------

describe('lib/comments constants', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any

  before(async () => {
    mod = await import('@/lib/comments')
  })

  it('COMMENT_BODY_MAX_LENGTH is 2000', () => {
    assert.equal(mod.COMMENT_BODY_MAX_LENGTH, 2000)
  })

  it('COMMENTS_GET_RATE_LIMIT is 60', () => {
    assert.equal(mod.COMMENTS_GET_RATE_LIMIT, 60)
  })

  it('COMMENTS_POST_RATE_LIMIT is 30', () => {
    assert.equal(mod.COMMENTS_POST_RATE_LIMIT, 30)
  })
})

// ---------------------------------------------------------------------------
// rowToComment — snake_case DB row → camelCase Comment contract
// ---------------------------------------------------------------------------

describe('rowToComment', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rowToComment: (row: Record<string, any>) => any

  before(async () => {
    ;({ rowToComment } = await import('@/lib/comments'))
  })

  const row = {
    id: 'cd71b97f-ad41-464e-b30c-cf8e0532c33b',
    video_version_id: 'c8a40130-be14-43e8-b075-4cb849bf2263',
    agency_id: '3e44aa4d-76ec-4acf-8959-eeac95b40a40',
    user_id: 'ad1e2e82-61ab-4065-a3ec-bc435db0a48a',
    content: 'Great energy here',
    comment_type: 'point',
    timestamp_seconds: 4.2,
    end_timestamp_seconds: null,
    parent_id: null,
    resolved: false,
    resolved_at: null,
    resolved_by: null,
    deleted_at: null,
    created_at: '2026-06-16T02:29:01.223860+00:00',
  }

  it('maps every field to its camelCase key', () => {
    const c = rowToComment(row)
    assert.equal(c.videoVersionId, row.video_version_id)
    assert.equal(c.agencyId, row.agency_id)
    assert.equal(c.userId, row.user_id)
    assert.equal(c.commentType, row.comment_type)
    assert.equal(c.timestampSeconds, row.timestamp_seconds)
    assert.equal(c.endTimestampSeconds, row.end_timestamp_seconds)
    assert.equal(c.parentId, row.parent_id)
    assert.equal(c.createdAt, row.created_at)
  })

  it('preserves null parentId so top-level comments pass the `parentId === null` filter', () => {
    const c = rowToComment(row)
    assert.strictEqual(c.parentId, null) // not undefined — CommentPanel filters on === null
  })

  it('does not leak snake_case keys', () => {
    const c = rowToComment(row) as Record<string, unknown>
    assert.equal(c.parent_id, undefined)
    assert.equal(c.timestamp_seconds, undefined)
    assert.equal(c.comment_type, undefined)
  })
})

// ---------------------------------------------------------------------------
// POST handler behaviour — the real handler runs end to end, with Supabase
// REST/Auth + Upstash stubbed at the fetch layer and the Next request scope
// (cookies()) supplied via AsyncLocalStorage. Replies are one level deep
// (migration 0008): a reply to a reply must be a 400, never a 500.
// ---------------------------------------------------------------------------

describe('comments POST — reply depth (real handler)', () => {
  const SB = 'https://sb.comments-post.test'
  const REDIS = 'https://redis.comments-post.test'
  const AGENCY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const OTHER_AGENCY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const USER = '11111111-1111-4111-8111-111111111111'
  const VIDEO = '22222222-2222-4222-8222-222222222222'
  const VERSION = '33333333-3333-4333-8333-333333333333'
  const OTHER_VERSION = '33333333-3333-4333-8333-444444444444'
  const TOP = '44444444-4444-4444-8444-444444444444' // top-level comment
  const REPLY = '55555555-5555-4555-8555-555555555555' // reply to TOP
  const NEW_ID = '66666666-6666-4666-8666-666666666666'
  const realFetch = globalThis.fetch

  type ParentRow = {
    id: string
    video_version_id: string
    agency_id: string
    parent_id: string | null
    deleted_at: string | null
  }
  const parentRow = (over: Partial<ParentRow> & { id: string }): ParentRow => ({
    video_version_id: VERSION,
    agency_id: AGENCY,
    parent_id: null,
    deleted_at: null,
    ...over,
  })

  let parents: ParentRow[] = []
  let insertError: { code: string; message: string } | null = null
  let calls: { method: string; url: URL; body: unknown }[] = []
  let POST: (
    req: NextRequest,
    ctx: { params: { videoId: string; versionId: string } }
  ) => Promise<Response>
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
      const eq = (k: string) => url.searchParams.get(k)?.replace(/^eq\./, '')
      const single = (rows: unknown[]) =>
        rows.length
          ? json(200, rows[0])
          : json(406, { code: 'PGRST116', message: 'no rows', details: '', hint: null })

      if (url.pathname === '/auth/v1/user') {
        return json(200, {
          id: USER,
          aud: 'authenticated',
          role: 'authenticated',
          email: 'agent@comments-post.test',
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        })
      }
      if (url.pathname === '/rest/v1/videos') {
        return single(eq('id') === VIDEO ? [{ id: VIDEO, agency_id: AGENCY, talent_id: USER }] : [])
      }
      if (url.pathname === '/rest/v1/memberships') {
        // Used by both the access check (.single) and the notification fan-out (list).
        // The caller is an agent. The list form is the notification fan-out, which
        // excludes the author, so it is empty here.
        return new Headers(init.headers).get('accept')?.includes('pgrst.object')
          ? json(200, { role: 'agent' })
          : json(200, [])
      }
      if (url.pathname === '/rest/v1/video_versions') {
        return single(eq('id') === VERSION ? [{ id: VERSION }] : [])
      }
      if (url.pathname === '/rest/v1/notifications') {
        return json(201, [])
      }
      if (url.pathname === '/rest/v1/comments' && method === 'GET') {
        return single(parents.filter((p) => p.id === eq('id')))
      }
      if (url.pathname === '/rest/v1/comments' && method === 'POST') {
        if (insertError) return json(400, { ...insertError, details: null, hint: null })
        const b = body as Record<string, unknown>
        return json(201, {
          id: NEW_ID,
          ...b,
          resolved: false,
          resolved_at: null,
          resolved_by: null,
          deleted_at: null,
          created_at: new Date().toISOString(),
          users: { full_name: 'Alex Agent', avatar_url: null },
        })
      }
      return json(404, { message: `unexpected ${method} ${url.pathname}` })
    }) as typeof fetch
  }

  before(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SB
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-comments-post-test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-comments-post-test'
    process.env.UPSTASH_REDIS_REST_URL = REDIS
    process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-comments-post-test'
    // Next's request-scope storage needs the global ALS that its server runtime normally installs.
    const { AsyncLocalStorage } = await import('node:async_hooks')
    ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
    const { requestAsyncStorage } =
      await import('next/dist/client/components/request-async-storage.external')

    // Session cookie that @supabase/ssr turns into a (non-expired) session for getUser().
    const session = {
      access_token: 'access-comments-post-test',
      refresh_token: 'refresh-comments-post-test',
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
  })

  function post(parentId: string | undefined, over: { versionId?: string } = {}) {
    calls = []
    installFetch()
    const req = new Request(
      `http://localhost:3000/api/videos/${VIDEO}/versions/${over.versionId ?? VERSION}/comments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: 'Agreed, tighten the pause.',
          comment_type: 'point',
          timestamp_seconds: 12,
          ...(parentId ? { parent_id: parentId } : {}),
        }),
      }
    ) as unknown as NextRequest
    return runInScope(() =>
      POST(req, { params: { videoId: VIDEO, versionId: over.versionId ?? VERSION } })
    )
  }

  const inserts = () =>
    calls.filter((c) => c.url.pathname === '/rest/v1/comments' && c.method === 'POST')

  it('reply to a reply -> 400 "Replies can only be one level deep", no insert', async () => {
    parents = [parentRow({ id: TOP }), parentRow({ id: REPLY, parent_id: TOP })]
    insertError = null
    const res = await post(REPLY)
    assert.equal(res.status, 400)
    assert.deepEqual(await res.json(), { error: 'Replies can only be one level deep' })
    assert.equal(inserts().length, 0, 'the depth guard must run before the insert')
  })

  it('reply to a top-level comment -> 201, inserted with parent_id', async () => {
    parents = [parentRow({ id: TOP })]
    insertError = null
    const res = await post(TOP)
    assert.equal(res.status, 201)
    const { comment } = (await res.json()) as {
      comment: { id: string; parentId: string; authorName: string }
    }
    assert.equal(comment.id, NEW_ID)
    assert.equal(comment.parentId, TOP)
    assert.equal(comment.authorName, 'Alex Agent')
    assert.equal(inserts().length, 1)
    assert.equal((inserts()[0].body as { parent_id: string }).parent_id, TOP)
  })

  it('top-level comment (no parent_id) -> 201 and never looks up a parent', async () => {
    parents = []
    insertError = null
    const res = await post(undefined)
    assert.equal(res.status, 201)
    assert.equal((inserts()[0].body as { parent_id: unknown }).parent_id, null)
    assert.equal(
      calls.filter((c) => c.url.pathname === '/rest/v1/comments' && c.method === 'GET').length,
      0
    )
  })

  it('reply race: trigger raises 23514 at insert -> 400, same message (not a 500)', async () => {
    parents = [parentRow({ id: TOP })] // parent looked top-level at check time...
    insertError = {
      code: '23514',
      message: 'Replies can only be made to top-level comments (max depth 1)',
    }
    const logged = mock.method(console, 'error', () => {})
    const res = await post(TOP) // ...but the trigger rejects the insert
    logged.mock.restore()
    assert.equal(res.status, 400)
    assert.deepEqual(await res.json(), { error: 'Replies can only be one level deep' })
    // A mislabelled check violation must stay visible in the logs.
    assert.equal(logged.mock.callCount(), 1)
    assert.match(String(logged.mock.calls[0].arguments[0]), /\[comments:POST\].*23514/)
    assert.equal((logged.mock.calls[0].arguments[1] as { code: string }).code, '23514')
  })

  it('a 23514 on a top-level insert is some other constraint -> stays a 500', async () => {
    parents = []
    insertError = { code: '23514', message: 'check constraint violated' }
    const logged = mock.method(console, 'error', () => {})
    const res = await post(undefined)
    logged.mock.restore()
    assert.equal(res.status, 500)
    assert.equal(logged.mock.callCount(), 1)
  })

  it('a different insert failure on a reply is still a 500', async () => {
    parents = [parentRow({ id: TOP })]
    insertError = { code: 'XX000', message: 'boom' }
    const logged = mock.method(console, 'error', () => {})
    const res = await post(TOP)
    logged.mock.restore()
    assert.equal(res.status, 500)
    assert.equal(logged.mock.callCount(), 1)
  })

  it('earlier parent checks still win: deleted / other version / other agency / missing', async () => {
    insertError = null
    const cases: [string, ParentRow[], string, string][] = [
      ['missing', [], TOP, 'Parent comment not found'],
      [
        'deleted',
        [parentRow({ id: TOP, deleted_at: '2026-10-23T10:00:00Z' })],
        TOP,
        'Cannot reply to a deleted comment',
      ],
      [
        'other version',
        [parentRow({ id: TOP, video_version_id: OTHER_VERSION })],
        TOP,
        'Parent comment belongs to a different version',
      ],
      [
        'other agency (even if it is a reply)',
        [parentRow({ id: REPLY, agency_id: OTHER_AGENCY, parent_id: TOP })],
        REPLY,
        'Parent comment belongs to a different agency',
      ],
    ]
    for (const [label, rows, parent, expected] of cases) {
      parents = rows
      const res = await post(parent)
      assert.equal(res.status, 400, label)
      assert.equal(((await res.json()) as { error: string }).error, expected, label)
      assert.equal(inserts().length, 0, label)
    }
  })
})
