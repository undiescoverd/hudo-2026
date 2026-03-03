/**
 * Unit tests for the versions list and playback-url API routes.
 *
 * Tests validation logic, security invariants, and version selection.
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 *
 * Run: npx tsx --test app/api/videos/\\[videoId\\]/versions/route.test.ts
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// ── Extracted constants (must match route.ts) ─────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('versions route — UUID validation', () => {
  it('accepts a valid UUID', () => {
    assert.ok(UUID_RE.test('a1b2c3d4-e5f6-7890-abcd-ef1234567890'))
  })

  it('rejects a malformed UUID', () => {
    assert.ok(!UUID_RE.test('not-a-uuid'))
  })

  it('rejects SQL injection', () => {
    assert.ok(!UUID_RE.test("'; DROP TABLE videos; --"))
  })
})

describe('versions route — source invariants', () => {
  // Source invariant checks verify security-critical patterns exist.
  // Full behavior tests require Next.js runtime and Supabase — these
  // guards catch accidental removal of auth, rate limiting, and security.
  let source: string

  before(async () => {
    const fs = await import('node:fs')
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const routePath = path.resolve(currentDir, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('exports a GET handler', () => {
    assert.match(source, /export async function GET/)
  })

  it('never exposes r2_key in the response', () => {
    const selectMatch = source.match(/\.select\(['"](.*?)['"]\)/)
    assert.ok(selectMatch, '.select() call must exist in the source')
    assert.doesNotMatch(selectMatch[1], /r2_key/, 'r2_key must not be in the select query')
  })

  it('orders versions by version_number descending', () => {
    assert.match(source, /order\('version_number',\s*\{\s*ascending:\s*false\s*\}/)
  })

  it('validates videoId with UUID helper', () => {
    assert.match(source, /isValidUUID\(videoId\)/)
  })

  it('applies rate limiting', () => {
    assert.match(source, /versions:get:user/)
  })
})

describe('playback-url route — source invariants', () => {
  let source: string

  before(async () => {
    const fs = await import('node:fs')
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const routePath = path.resolve(currentDir, '../playback-url/route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('supports versionId query parameter', () => {
    assert.match(source, /versionId/)
    assert.match(source, /searchParams/)
  })

  it('validates versionId as UUID format', () => {
    assert.match(source, /isValidUUID\(versionId\)/)
    assert.match(source, /Invalid version ID format/)
  })

  it('validates videoId as UUID format', () => {
    assert.match(source, /isValidUUID\(videoId\)/)
  })

  it('includes versionNumber in response', () => {
    assert.match(source, /versionNumber/)
  })

  it('uses generateSignedUrl (never direct R2 URLs)', () => {
    assert.match(source, /generateSignedUrl/)
  })

  it('applies rate limiting', () => {
    assert.match(source, /playback:get:user/)
  })
})
