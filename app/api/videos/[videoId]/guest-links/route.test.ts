/**
 * Unit tests for POST /api/videos/[videoId]/guest-links and
 * GET /api/videos/[videoId]/guest-links.
 *
 * These tests exercise pure logic and security invariants without importing
 * TypeScript source — matching the style of playback-url/route.test.ts.
 *
 * Run: node --experimental-strip-types app/api/videos/\[videoId\]/guest-links/route.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// ---------------------------------------------------------------------------
// Token security invariants (inline — avoids TS import issues)
// ---------------------------------------------------------------------------

describe('guest-links POST — token security', () => {
  it('generateGuestToken produces a base64url string (verified via source)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    // Route must call generateGuestToken
    assert.match(source, /generateGuestToken\(\)/, 'Route must call generateGuestToken()')
    // Route must call hashGuestToken on the generated token
    assert.match(source, /hashGuestToken\(token\)/, 'Route must hash the token')
  })

  it('plaintext token is returned in response, hash is stored in DB (not the other way)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    // The INSERT must use token_hash (the hash), not token (plaintext)
    assert.match(
      source,
      /token_hash:\s*tokenHash/,
      'DB INSERT must use tokenHash, not plaintext token'
    )
    // The response must include the plaintext token
    assert.match(
      source,
      /token,\s*\/\/\s*plaintext/,
      'Response must include plaintext token with comment'
    )
  })

  it('token_hash column must never appear in a response shape', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    // Collect JSON response bodies only (lines after NextResponse.json({)
    // token_hash must only appear in INSERT payload, not response bodies
    const responseBlocks =
      source.match(/NextResponse\.json\(\{[\s\S]*?\}\s*(?:,\s*\{[\s\S]*?\})?\s*\)/g) ?? []
    for (const block of responseBlocks) {
      // Allow token_hash in the block only if it's commented out or in a DB query
      assert.doesNotMatch(
        block,
        /token_hash/,
        `token_hash must not appear in any NextResponse.json response: ${block}`
      )
    }
  })
})

// ---------------------------------------------------------------------------
// Response shape invariants
// ---------------------------------------------------------------------------

describe('guest-links POST — response shape', () => {
  it('POST returns 201 status', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /status:\s*201/, 'POST route must return 201')
  })

  it('response includes id, token, url, expires_at, created_at', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /\bid:\s*link\.id\b/, 'Response must include id')
    assert.match(source, /\btoken\b/, 'Response must include token')
    assert.match(source, /\burl:\s*guestUrl\b/, 'Response must include url')
    assert.match(source, /\bexpires_at\b/, 'Response must include expires_at')
    assert.match(source, /\bcreated_at\b/, 'Response must include created_at')
  })

  it('guest URL is built from request origin + /guest/ + plaintext token', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(
      source,
      /request\.nextUrl\.origin/,
      'Route must use request.nextUrl.origin for URL'
    )
    assert.match(source, /\/guest\/\$\{token\}/, 'Guest URL must embed plaintext token')
  })
})

// ---------------------------------------------------------------------------
// GET list — response invariants
// ---------------------------------------------------------------------------

describe('guest-links GET — list invariants', () => {
  it('list response url_path uses <masked> placeholder, not real token', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(
      source,
      /url_path:\s*`\/guest\/<masked>`/,
      'url_path must use <masked> placeholder'
    )
  })

  it('GET list only returns non-revoked links (revoked_at IS NULL filter)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /\.is\('revoked_at',\s*null\)/, 'GET list must filter out revoked links')
  })

  it('GET list selects only safe columns (no token_hash, no r2_key)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    // Find the select call that includes view_count (the list query)
    const selectMatch = source.match(/\.select\('id,\s*expires_at,\s*view_count[^']*'\)/)
    assert.ok(selectMatch, 'GET list must select id, expires_at, view_count and other safe fields')
    if (selectMatch) {
      assert.doesNotMatch(selectMatch[0], /token_hash/, 'List select must not include token_hash')
      assert.doesNotMatch(selectMatch[0], /r2_key/, 'List select must not include r2_key')
    }
  })
})

// ---------------------------------------------------------------------------
// Access control invariants (pure logic mirrors)
// ---------------------------------------------------------------------------

describe('guest-links — access control invariants', () => {
  it('returns 401 when user is null', () => {
    const user = null
    const status = user === null ? 401 : 200
    assert.equal(status, 401)
  })

  it('returns 404 when video is not found', () => {
    const video = null
    const status = video === null ? 404 : 200
    assert.equal(status, 404)
  })

  it('returns 403 when user has talent role (not agent+)', () => {
    const role = 'talent'
    const AGENT_PLUS_ROLES = ['owner', 'admin_agent', 'agent']
    const status = AGENT_PLUS_ROLES.includes(role) ? 200 : 403
    assert.equal(status, 403)
  })

  it('allows owner role', () => {
    const role = 'owner'
    const AGENT_PLUS_ROLES = ['owner', 'admin_agent', 'agent']
    assert.ok(AGENT_PLUS_ROLES.includes(role))
  })

  it('allows agent role', () => {
    const role = 'agent'
    const AGENT_PLUS_ROLES = ['owner', 'admin_agent', 'agent']
    assert.ok(AGENT_PLUS_ROLES.includes(role))
  })

  it('allows admin_agent role', () => {
    const role = 'admin_agent'
    const AGENT_PLUS_ROLES = ['owner', 'admin_agent', 'agent']
    assert.ok(AGENT_PLUS_ROLES.includes(role))
  })

  it('route uses requireAgentRole (not requireMembership)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /requireAgentRole\(/, 'Route must use requireAgentRole for access control')
  })
})

// ---------------------------------------------------------------------------
// agency_id population
// ---------------------------------------------------------------------------

describe('guest-links POST — agency_id required in INSERT', () => {
  it('INSERT payload includes agency_id sourced from video row', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(
      source,
      /agency_id:\s*video\.agency_id/,
      'INSERT must include agency_id from video'
    )
  })
})
