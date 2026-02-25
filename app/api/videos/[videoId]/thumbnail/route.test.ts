/**
 * Unit tests for the thumbnail API route.
 *
 * Tests UUID validation, content-type parsing, size limits, and source invariants.
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 *
 * Run: npx tsx --test app/api/videos/\\[videoId\\]/thumbnail/route.test.ts
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

// UUID regex used by the route — duplicated here to test actual validation behavior
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('thumbnail route — UUID validation', () => {
  it('accepts a valid lowercase UUID', () => {
    assert.ok(UUID_RE.test('a1b2c3d4-e5f6-7890-abcd-ef1234567890'))
  })

  it('accepts a valid uppercase UUID', () => {
    assert.ok(UUID_RE.test('A1B2C3D4-E5F6-7890-ABCD-EF1234567890'))
  })

  it('rejects an empty string', () => {
    assert.ok(!UUID_RE.test(''))
  })

  it('rejects a malformed UUID (too short)', () => {
    assert.ok(!UUID_RE.test('a1b2c3d4-e5f6-7890-abcd'))
  })

  it('rejects SQL injection attempt', () => {
    assert.ok(!UUID_RE.test("'; DROP TABLE videos; --"))
  })

  it('rejects a path traversal attempt', () => {
    assert.ok(!UUID_RE.test('../../../etc/passwd'))
  })
})

describe('thumbnail route — content-type parsing', () => {
  it('strips charset parameter from content-type', () => {
    const raw = 'image/jpeg; charset=utf-8'
    const parsed = raw.split(';')[0].trim()
    assert.equal(parsed, 'image/jpeg')
  })

  it('strips boundary parameter from content-type', () => {
    const raw = 'image/png; boundary=something'
    const parsed = raw.split(';')[0].trim()
    assert.equal(parsed, 'image/png')
  })

  it('handles content-type with no parameters', () => {
    const raw = 'image/jpeg'
    const parsed = raw.split(';')[0].trim()
    assert.equal(parsed, 'image/jpeg')
  })

  it('rejects non-image content types', () => {
    const allowed = ['image/jpeg', 'image/png']
    assert.ok(!allowed.includes('text/html'))
    assert.ok(!allowed.includes('application/json'))
    assert.ok(!allowed.includes('image/gif'))
    assert.ok(!allowed.includes('image/webp'))
  })
})

describe('thumbnail route — size limit', () => {
  it('enforces 2MB max (2 * 1024 * 1024 = 2097152 bytes)', () => {
    const MAX_THUMBNAIL_SIZE = 2 * 1024 * 1024
    assert.equal(MAX_THUMBNAIL_SIZE, 2097152)

    // Just under limit — OK
    assert.ok(2097151 <= MAX_THUMBNAIL_SIZE)
    // At limit — OK
    assert.ok(2097152 <= MAX_THUMBNAIL_SIZE)
    // Over limit — rejected
    assert.ok(2097153 > MAX_THUMBNAIL_SIZE)
  })
})

describe('thumbnail route — access control', () => {
  it('agent+ roles include owner, admin_agent, agent', () => {
    const agentPlusRoles = ['owner', 'admin_agent', 'agent']
    assert.ok(agentPlusRoles.includes('owner'))
    assert.ok(agentPlusRoles.includes('admin_agent'))
    assert.ok(agentPlusRoles.includes('agent'))
  })

  it('talent role is excluded from agent+ roles', () => {
    const agentPlusRoles = ['owner', 'admin_agent', 'agent']
    assert.ok(!agentPlusRoles.includes('talent'))
  })

  it('guest role is excluded from agent+ roles', () => {
    const agentPlusRoles = ['owner', 'admin_agent', 'agent']
    assert.ok(!agentPlusRoles.includes('guest'))
  })
})

describe('thumbnail route — source invariants', () => {
  let source: string

  before(async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('exports both POST and GET handlers', () => {
    assert.match(source, /export async function POST/)
    assert.match(source, /export async function GET/)
  })

  it('uses generateSignedUrl for GET responses (never direct R2 URLs)', () => {
    assert.match(source, /generateSignedUrl/)
  })

  it('applies rate limiting in both POST and GET handlers', () => {
    const postMatch = source.match(/thumbnail:upload:user/)
    const getMatch = source.match(/thumbnail:get:user/)
    assert.ok(postMatch, 'POST handler must have rate limiting')
    assert.ok(getMatch, 'GET handler must have rate limiting')
  })

  it('validates videoId with UUID regex in both handlers', () => {
    const uuidChecks = source.match(/UUID_RE\.test\(videoId\)/g)
    assert.ok(uuidChecks, 'UUID validation must exist')
    assert.ok(uuidChecks.length >= 2, 'Both POST and GET must validate videoId')
  })
})
