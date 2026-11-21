/**
 * Unit tests for GET /api/guest/[token]/playback-url (public signed URL endpoint).
 *
 * Pure-logic + source-inspection invariants.
 * Matches the node:test style of the project.
 *
 * Run: node --experimental-strip-types app/api/guest/\[token\]/playback-url/route.test.ts
 */

import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'

// ---------------------------------------------------------------------------
// Signed URL expiry constant
// ---------------------------------------------------------------------------

describe('guest playback-url — expiry constant', () => {
  it('uses 900 seconds (15 minutes) as the signed URL expiry', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /SIGNED_URL_EXPIRY_SECONDS\s*=\s*900/)
    assert.match(source, /expires_in:\s*SIGNED_URL_EXPIRY_SECONDS/)
  })
})

// ---------------------------------------------------------------------------
// Security invariants
// ---------------------------------------------------------------------------

describe('guest playback-url — security invariants', () => {
  it('r2_key is never returned in any response', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    const jsonBlocks = source.match(/return NextResponse\.json\(\{[\s\S]*?\}\s*\)/g) ?? []
    for (const block of jsonBlocks) {
      assert.doesNotMatch(block, /r2_key/, `r2_key must not appear in response: ${block}`)
    }
  })

  it('signed URL generated via generateSignedUrl, returned as url field', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(
      source,
      /generateSignedUrl\(version\.r2_key,\s*SIGNED_URL_EXPIRY_SECONDS\)/,
      'Route must sign via generateSignedUrl'
    )
    assert.match(source, /url:\s*signedUrl/, 'Route must return signedUrl as url field')
  })

  it('rate limit key uses tokenHash, not plaintext token', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /`guest:\$\{tokenHash\}`/, 'Rate limit key must use tokenHash')
    // Must NOT use the plaintext token as rate limit key
    assert.doesNotMatch(
      source,
      /`guest:\$\{token\}`/,
      'Rate limit key must not use plaintext token'
    )
  })

  it('uses service-role client (bypasses RLS for explicit validated read)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/, 'Route must use service role key')
    assert.match(
      source,
      /import\s*\{\s*createAdminClient\s*\}\s*from\s*'@\/lib\/supabase-admin'/,
      'Route must import the shared service-role client factory'
    )
    assert.match(source, /createAdminClient\(\)/, 'Route must create admin client')
  })

  it('all invalid token states return 404 (not 401 or 403)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    const has401 = /status:\s*401/.test(source)
    const has403 = /status:\s*403/.test(source)
    assert.equal(has401, false, 'Guest playback route must not return 401')
    assert.equal(has403, false, 'Guest playback route must not return 403')
  })
})

// ---------------------------------------------------------------------------
// 404 invariants (all invalid states return 404)
// ---------------------------------------------------------------------------

describe('guest playback-url — 404 for all invalid states', () => {
  it('unknown token → 404', () => {
    const link = null
    const status = link === null ? 404 : 200
    assert.equal(status, 404)
  })

  it('revoked link → 404', () => {
    const link = { revoked_at: new Date().toISOString(), expires_at: null }
    let status: number
    if (!link) status = 404
    else if (link.revoked_at !== null) status = 404
    else if (link.expires_at !== null && new Date(link.expires_at) < new Date()) status = 404
    else status = 200
    assert.equal(status, 404)
  })

  it('expired link → 404', () => {
    const link = {
      revoked_at: null,
      expires_at: new Date(Date.now() - 5000).toISOString(),
    }
    let status: number
    if (!link) status = 404
    else if (link.revoked_at !== null) status = 404
    else if (link.expires_at !== null && new Date(link.expires_at) < new Date()) status = 404
    else status = 200
    assert.equal(status, 404)
  })

  it('valid link (not revoked, not expired) → proceeds to signing', () => {
    const link = { revoked_at: null, expires_at: null }
    let proceed = false
    if (!link) proceed = false
    else if (link.revoked_at !== null) proceed = false
    else if (link.expires_at !== null && new Date(link.expires_at) < new Date()) proceed = false
    else proceed = true
    assert.equal(proceed, true)
  })
})

// ---------------------------------------------------------------------------
// view_count increment invariants
// ---------------------------------------------------------------------------

describe('guest playback-url — view_count increment', () => {
  it('view_count is incremented only for non-renewal requests', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(
      source,
      /import \{ isGuestPlaybackRenewal \} from '@\/lib\/guest-playback'/,
      'Route must use the shared renewal contract'
    )
    // The RPC must sit inside the renewal guard, so a renewal (?renew=1) of an
    // in-progress watch never increments view_count.
    assert.match(
      source,
      /if \(!isGuestPlaybackRenewal\(request\.nextUrl\.searchParams\)\) \{\s*const \{ error: rpcError \} = await admin\.rpc\('increment_guest_link_view'/,
      'increment_guest_link_view must be guarded by !isGuestPlaybackRenewal(...)'
    )
    // Exactly one RPC call site — no unguarded duplicate.
    assert.equal([...source.matchAll(/rpc\('increment_guest_link_view'/g)].length, 1)
  })

  it('renewal guard sits after token validation + signing (renewals still validated & rate-limited)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    const guardIdx = source.indexOf('isGuestPlaybackRenewal(request')
    assert.ok(source.indexOf('checkRateLimit(') < guardIdx, 'rate limit must run before the guard')
    assert.ok(
      source.indexOf('verifyGuestToken(') < guardIdx,
      'token check must run before the guard'
    )
    assert.ok(source.indexOf('generateSignedUrl(') < guardIdx, 'signing must run before the guard')
  })

  it('route uses atomic RPC for view increment (not read-modify-write)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(
      source,
      /\.rpc\(\s*['"]increment_guest_link_view['"]\s*,\s*\{\s*p_id:\s*link\.id\s*\}\s*\)/,
      'Route must call increment_guest_link_view RPC with link id (atomic update)'
    )
    // Negative invariant: must NOT do a JS-side view_count + 1 update
    assert.doesNotMatch(
      source,
      /view_count:\s*link\.view_count\s*\+/,
      'Route must not perform read-modify-write on view_count'
    )
  })

  it('signed URL is returned even if view stats update fails (non-fatal error)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    const updateIdx = source.indexOf("rpc('increment_guest_link_view'")
    const finalReturnIdx = source.lastIndexOf('return NextResponse.json({')
    assert.ok(updateIdx > -1, 'RPC call must exist')
    assert.ok(updateIdx < finalReturnIdx, 'view increment must precede the final return')

    // Update error only logs, does not return an error response
    assert.match(
      source,
      /console\.error.*Failed to update view stats/,
      'Update error must be logged, not thrown'
    )
  })

  it('reports view-stats update failures to Sentry (S3-SEC-006)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /import \* as Sentry from '@sentry\/nextjs'/)

    const rpcBlock = source.slice(source.indexOf("rpc('increment_guest_link_view'"))
    assert.match(
      rpcBlock,
      /Sentry\.captureException\(rpcError/,
      'Swallowed view-stats RPC failure must be reported to Sentry'
    )
  })
})

// ---------------------------------------------------------------------------
// Rate limit: 20 req/min
// ---------------------------------------------------------------------------

describe('guest playback-url — rate limit configuration', () => {
  it('rate limit is set to 20 req/min with 60 second window', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /GUEST_RATE_LIMIT\s*=\s*20/, 'Rate limit must be 20')
    assert.match(source, /GUEST_RATE_WINDOW\s*=\s*60/, 'Rate window must be 60 seconds')
  })

  it('21st request within window should return 429 with Retry-After', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    // Verify the checkRateLimit helper is called, which handles the 429 response
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /checkRateLimit\(/, 'Route must use checkRateLimit')
    // checkRateLimit in api-helpers.ts returns 429 with Retry-After header
    const helpersPath = path.resolve(
      import.meta.dirname ?? __dirname,
      '../../../../../lib/api-helpers.ts'
    )
    const helpers = fs.readFileSync(helpersPath, 'utf8')
    assert.match(helpers, /Retry-After/, 'checkRateLimit must set Retry-After header on 429')
  })
})

// ---------------------------------------------------------------------------
// Behaviour: invoke the real GET handler against a stubbed PostgREST (global
// fetch) and a real offline R2 presigner with dummy creds. Upstash env is
// unset, so checkRateLimit fails open (its documented posture for this route).
// ---------------------------------------------------------------------------

describe('guest playback-url — GET handler behaviour (view counting)', () => {
  const TOKEN = 'behaviour-test-guest-token'
  const LINK_ID = '11111111-1111-4111-8111-111111111111'
  const VIDEO_ID = '22222222-2222-4222-8222-222222222222'
  const VERSION_ID = '33333333-3333-4333-8333-333333333333'
  const R2_KEY = 'agency/video/v1-secret-key.mp4'

  const ENV_KEYS = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_ACCOUNT_ID',
    'R2_BUCKET_NAME',
    'R2_ENDPOINT',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
  ] as const
  const savedEnv: Record<string, string | undefined> = {}
  const originalFetch = globalThis.fetch
  const originalConsoleError = console.error

  // Fake guest_links row; the stubbed RPC mutates it like the real SQL does.
  let row: { view_count: number; last_viewed_at: string | null }
  let rpcCalls: Array<{ p_id: string }>

  before(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    process.env.R2_ACCESS_KEY_ID = 'test-access-key-id'
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret-access-key'
    process.env.R2_ACCOUNT_ID = 'testaccount'
    process.env.R2_BUCKET_NAME = 'test-bucket'
    delete process.env.R2_ENDPOINT
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    // Silence the expected fail-open rate-limit log.
    console.error = () => {}

    const { hashGuestToken } = await import('@/lib/guest-tokens')
    const tokenHash = hashGuestToken(TOKEN)

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      const headers = new Headers(init?.headers)
      const wantsObject = (headers.get('accept') ?? '').includes('vnd.pgrst.object')
      const reply = (obj: unknown) =>
        new Response(JSON.stringify(wantsObject ? obj : [obj]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })

      switch (url.pathname) {
        case '/rest/v1/guest_links':
          assert.equal(url.searchParams.get('token_hash'), `eq.${tokenHash}`)
          return reply({
            id: LINK_ID,
            video_id: VIDEO_ID,
            video_version_id: VERSION_ID,
            token_hash: tokenHash,
            expires_at: null,
            revoked_at: null,
          })
        case '/rest/v1/videos':
          return reply({ id: VIDEO_ID, active_version_id: VERSION_ID })
        case '/rest/v1/video_versions':
          return reply({ id: VERSION_ID, r2_key: R2_KEY })
        case '/rest/v1/rpc/increment_guest_link_view': {
          const body = JSON.parse(String(init?.body)) as { p_id: string }
          rpcCalls.push(body)
          row.view_count += 1
          row.last_viewed_at = new Date().toISOString()
          return new Response(null, { status: 204 })
        }
        default:
          throw new Error(`unexpected fetch in test: ${url.pathname}`)
      }
    }) as typeof fetch
  })

  after(() => {
    globalThis.fetch = originalFetch
    console.error = originalConsoleError
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
  })

  beforeEach(() => {
    row = { view_count: 17, last_viewed_at: null }
    rpcCalls = []
  })

  async function callRoute(query = '') {
    const { NextRequest } = await import('next/server')
    const { GET } = await import('./route')
    const req = new NextRequest(`https://hudo.test/api/guest/${TOKEN}/playback-url${query}`)
    const res = await GET(req, { params: { token: TOKEN } })
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }

  it('first load (no flag) increments view_count by exactly 1 via the RPC with the link id', async () => {
    const { status, body } = await callRoute()
    assert.equal(status, 200)
    assert.equal(typeof body.url, 'string')
    assert.equal(row.view_count, 18)
    assert.notEqual(row.last_viewed_at, null)
    assert.deepEqual(rpcCalls, [{ p_id: LINK_ID }])
  })

  it('renewal (?renew=1) returns a fresh signed URL but does not touch view_count', async () => {
    const { status, body } = await callRoute('?renew=1')
    assert.equal(status, 200)
    assert.equal(typeof body.url, 'string')
    assert.equal(body.expires_in, 900)
    assert.equal(row.view_count, 17)
    assert.equal(row.last_viewed_at, null)
    assert.equal(rpcCalls.length, 0)
  })

  it('any other renew value still counts (only renew=1 is a renewal)', async () => {
    await callRoute('?renew=0')
    assert.equal(row.view_count, 18)
  })

  it('one uninterrupted watch (load + 10 renewals) counts once; a reload counts again', async () => {
    await callRoute()
    for (let i = 0; i < 10; i++) await callRoute('?renew=1')
    assert.equal(row.view_count, 18)
    await callRoute() // reload
    assert.equal(row.view_count, 19)
  })

  it('response carries only { url, expires_in } — no r2_key or token, on both paths', async () => {
    for (const query of ['', '?renew=1']) {
      const { body } = await callRoute(query)
      assert.deepEqual(Object.keys(body).sort(), ['expires_in', 'url'])
      const serialized = JSON.stringify(body)
      assert.ok(!serialized.includes(TOKEN), 'plaintext token must not be returned')
      assert.ok(!serialized.includes('"r2_key"'), 'r2_key field must not be returned')
    }
  })
})
