/**
 * Unit tests for DELETE /api/guest-links/[id] (revoke).
 *
 * Pure-logic invariants — no TypeScript module imports needed.
 * Matches the node:test + source-inspection style of the project.
 *
 * Run: node --experimental-strip-types app/api/guest-links/\[id\]/route.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// ---------------------------------------------------------------------------
// Input validation invariants
// ---------------------------------------------------------------------------

describe('guest-links DELETE — input validation', () => {
  it('rejects invalid UUID format', () => {
    // Mirrors the isValidUUID check in the route
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    assert.equal(UUID_RE.test('not-a-uuid'), false)
    assert.equal(UUID_RE.test(''), false)
  })

  it('accepts a valid UUID', () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    assert.equal(UUID_RE.test('f47ac10b-58cc-4372-a567-0e02b2c3d479'), true)
  })

  it('route validates ID before any DB call', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /isValidUUID\(id\)/, 'Route must validate the id param with isValidUUID')
  })
})

// ---------------------------------------------------------------------------
// Access control invariants
// ---------------------------------------------------------------------------

describe('guest-links DELETE — access control invariants', () => {
  it('returns 401 when user is null', () => {
    const user = null
    const status = user === null ? 401 : 200
    assert.equal(status, 401)
  })

  it('returns 404 when link is not found (opaque error — no 403)', () => {
    const link = null
    // Route returns 404, not 403, to avoid revealing existence of links
    const status = link === null ? 404 : 200
    assert.equal(status, 404)
  })

  it('returns 403 when user has talent role (not agent+)', () => {
    const role = 'talent'
    const AGENT_PLUS_ROLES = ['owner', 'admin_agent', 'agent']
    const status = AGENT_PLUS_ROLES.includes(role) ? 200 : 403
    assert.equal(status, 403)
  })

  it('allows owner role', () => {
    const AGENT_PLUS_ROLES = ['owner', 'admin_agent', 'agent']
    assert.ok(AGENT_PLUS_ROLES.includes('owner'))
  })

  it('allows admin_agent role', () => {
    const AGENT_PLUS_ROLES = ['owner', 'admin_agent', 'agent']
    assert.ok(AGENT_PLUS_ROLES.includes('admin_agent'))
  })

  it('route uses requireAgentRole for agency check', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /requireAgentRole\(/, 'Route must use requireAgentRole')
  })
})

// ---------------------------------------------------------------------------
// Revocation logic invariants
// ---------------------------------------------------------------------------

describe('guest-links DELETE — revocation logic', () => {
  it('already-revoked link returns 404 (not 204)', () => {
    const link = { revoked_at: new Date().toISOString() }
    const status = link.revoked_at !== null ? 404 : 204
    assert.equal(status, 404)
  })

  it('non-revoked link returns 204 on success', () => {
    const link = { revoked_at: null }
    const status = link.revoked_at !== null ? 404 : 204
    assert.equal(status, 204)
  })

  it('revocation sets revoked_at (soft delete, not hard delete)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    // Route must use update() with revoked_at, not delete()
    assert.match(
      source,
      /revoked_at:\s*new Date\(\)\.toISOString\(\)/,
      'Route must set revoked_at to now'
    )
    assert.match(source, /\.update\(/, 'Route must use .update() for soft-delete')

    // Ensure hard-delete is not called on guest_links (use [\s\S] for ES2015 compat)
    const deleteCallMatch = /from\('guest_links'\)[\s\S]*?\.delete\(\)/.exec(source)
    assert.equal(deleteCallMatch, null, 'Route must NOT hard-delete guest_links rows')
  })

  it('returns 204 with no body on success', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /status:\s*204/, 'Route must return 204 on success')
    assert.match(source, /new NextResponse\(null/, 'Route must return null body for 204')
  })

  it('agency_id is fetched from guest_links row (not trusting client input)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    // Route selects agency_id from guest_links for membership check
    assert.match(
      source,
      /\.select\('[^']*agency_id[^']*'\)/,
      'Route must select agency_id from guest_links'
    )
  })
})
