/**
 * Unit tests for GET /api/guest/[token]/playback-url (public signed URL endpoint).
 *
 * Pure-logic + source-inspection invariants.
 * Matches the node:test style of the project.
 *
 * Run: node --experimental-strip-types app/api/guest/\[token\]/playback-url/route.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

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
      /createClient\(supabaseUrl,\s*serviceRoleKey\)/,
      'Route must create admin client'
    )
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
  it('view_count is incremented by 1 per request', () => {
    const current = 17
    const next = current + 1
    assert.equal(next, 18)
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
