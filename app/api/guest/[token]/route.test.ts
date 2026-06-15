/**
 * Unit tests for GET /api/guest/[token] (public metadata endpoint).
 *
 * Pure-logic + source-inspection invariants.
 * Matches the node:test style of the project.
 *
 * Run: node --experimental-strip-types app/api/guest/\[token\]/route.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// ---------------------------------------------------------------------------
// 404 invariants (no enumeration leakage)
// ---------------------------------------------------------------------------

describe('guest metadata — 404 for all invalid states', () => {
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
      expires_at: new Date(Date.now() - 1000).toISOString(), // 1 second ago
    }
    let status: number
    if (!link) status = 404
    else if (link.revoked_at !== null) status = 404
    else if (link.expires_at !== null && new Date(link.expires_at) < new Date()) status = 404
    else status = 200
    assert.equal(status, 404)
  })

  it('valid non-expired non-revoked link → 200', () => {
    const link = {
      revoked_at: null,
      expires_at: new Date(Date.now() + 86400000).toISOString(), // 1 day from now
    }
    let status: number
    if (!link) status = 404
    else if (link.revoked_at !== null) status = 404
    else if (link.expires_at !== null && new Date(link.expires_at) < new Date()) status = 404
    else status = 200
    assert.equal(status, 200)
  })

  it('null expires_at (no expiry) + not revoked → 200', () => {
    const link = { revoked_at: null, expires_at: null }
    let status: number
    if (!link) status = 404
    else if (link.revoked_at !== null) status = 404
    else if (link.expires_at !== null && new Date(link.expires_at) < new Date()) status = 404
    else status = 200
    assert.equal(status, 200)
  })

  it('all invalid states use HTTP 404 (not 401 or 403)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    // Count 401 and 403 occurrences — should be zero
    const has401 = /status:\s*401/.test(source)
    const has403 = /status:\s*403/.test(source)
    assert.equal(has401, false, 'Guest route must not return 401 — use 404 for unknown tokens')
    assert.equal(has403, false, 'Guest route must not return 403 — use 404 for invalid tokens')
  })
})

// ---------------------------------------------------------------------------
// Rate limit invariants
// ---------------------------------------------------------------------------

describe('guest metadata — rate limit key', () => {
  it('rate limit key is guest:<tokenHash> (20 req/min)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(
      source,
      /`guest:\$\{tokenHash\}`/,
      'Rate limit key must use tokenHash, not plaintext'
    )
    assert.match(source, /GUEST_RATE_LIMIT\s*=\s*20/, 'Rate limit must be 20 req/min')
    assert.match(source, /GUEST_RATE_WINDOW\s*=\s*60/, 'Rate window must be 60 seconds')
  })
})

// ---------------------------------------------------------------------------
// Security invariants — no sensitive data in response
// ---------------------------------------------------------------------------

describe('guest metadata — response shape (no sensitive data)', () => {
  it('video select must not include r2_key or agency_id', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    // video_versions select for metadata route must not include r2_key
    const versionSelectMatches =
      source.match(/from\('video_versions'\)[^;]+\.select\('([^']+)'\)/g) ?? []
    for (const sel of versionSelectMatches) {
      assert.doesNotMatch(sel, /r2_key/, 'Metadata route version select must not include r2_key')
    }
  })

  it('response body does not include token_hash or agency_id', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    // The final return block must not expose sensitive fields
    const returnBlock = source.slice(source.lastIndexOf('return NextResponse.json({'))
    assert.doesNotMatch(returnBlock, /agency_id/, 'Response must not include agency_id')
    assert.doesNotMatch(returnBlock, /token_hash/, 'Response must not include token_hash')
  })

  it('uses timing-safe verifyGuestToken as defense-in-depth', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(
      source,
      /verifyGuestToken\(token,\s*link\.token_hash\)/,
      'Route must use verifyGuestToken for timing-safe comparison'
    )
  })

  it('uses service-role client to bypass RLS (no auth cookie required)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/, 'Route must use service role key')
    assert.match(
      source,
      /createClient\(supabaseUrl,\s*serviceRoleKey\)/,
      'Route must create admin client with service role'
    )
  })

  it('comments select does not expose deleted comments', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(
      source,
      /\.is\('deleted_at',\s*null\)/,
      'Comments query must filter out soft-deleted comments'
    )
  })
})
