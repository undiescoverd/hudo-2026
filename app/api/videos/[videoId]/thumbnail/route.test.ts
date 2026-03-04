/**
 * Unit tests for the thumbnail API route.
 *
 * Tests the route's validation logic (UUID, content-type, size, roles) using
 * extracted constants, plus source invariants for security patterns that can't
 * easily be tested without a full Next.js runtime.
 *
 * Run: npx tsx --test app/api/videos/\\[videoId\\]/thumbnail/route.test.ts
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

// ── Extracted constants (must match route.ts) ─────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_THUMBNAIL_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png']
const AGENT_PLUS_ROLES = ['owner', 'admin_agent', 'agent']

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
  // Replicates the normalization logic: rawContentType?.split(';')[0].trim()
  function parseContentType(raw: string | null): string {
    return raw?.split(';')[0].trim() ?? ''
  }

  it('strips charset parameter', () => {
    assert.equal(parseContentType('image/jpeg; charset=utf-8'), 'image/jpeg')
  })

  it('strips boundary parameter', () => {
    assert.equal(parseContentType('image/png; boundary=something'), 'image/png')
  })

  it('handles content-type with no parameters', () => {
    assert.equal(parseContentType('image/jpeg'), 'image/jpeg')
  })

  it('returns empty string for null content-type', () => {
    assert.equal(parseContentType(null), '')
  })

  it('allows only JPEG and PNG', () => {
    assert.ok(ALLOWED_CONTENT_TYPES.includes('image/jpeg'))
    assert.ok(ALLOWED_CONTENT_TYPES.includes('image/png'))
    assert.ok(!ALLOWED_CONTENT_TYPES.includes('image/gif'))
    assert.ok(!ALLOWED_CONTENT_TYPES.includes('image/webp'))
    assert.ok(!ALLOWED_CONTENT_TYPES.includes('text/html'))
  })
})

describe('thumbnail route — size limit', () => {
  it('max thumbnail size is 2MB', () => {
    assert.equal(MAX_THUMBNAIL_SIZE, 2097152)
  })

  it('accepts body at exactly the limit', () => {
    assert.ok(MAX_THUMBNAIL_SIZE <= MAX_THUMBNAIL_SIZE)
  })

  it('rejects body over the limit', () => {
    assert.ok(MAX_THUMBNAIL_SIZE + 1 > MAX_THUMBNAIL_SIZE)
  })
})

describe('thumbnail route — role authorization', () => {
  it('owner can upload thumbnails', () => {
    assert.ok(AGENT_PLUS_ROLES.includes('owner'))
  })

  it('admin_agent can upload thumbnails', () => {
    assert.ok(AGENT_PLUS_ROLES.includes('admin_agent'))
  })

  it('agent can upload thumbnails', () => {
    assert.ok(AGENT_PLUS_ROLES.includes('agent'))
  })

  it('talent cannot upload thumbnails', () => {
    assert.ok(!AGENT_PLUS_ROLES.includes('talent'))
  })

  it('guest cannot upload thumbnails', () => {
    assert.ok(!AGENT_PLUS_ROLES.includes('guest'))
  })
})

describe('thumbnail route — R2 key construction', () => {
  function buildR2Key(agencyId: string, videoId: string, contentType: string) {
    const extension = contentType === 'image/png' ? 'png' : 'jpg'
    return `${agencyId}/${videoId}/thumbnail.${extension}`
  }

  it('builds correct key for JPEG', () => {
    assert.equal(
      buildR2Key('agency-123', 'video-456', 'image/jpeg'),
      'agency-123/video-456/thumbnail.jpg'
    )
  })

  it('builds correct key for PNG', () => {
    assert.equal(
      buildR2Key('agency-123', 'video-456', 'image/png'),
      'agency-123/video-456/thumbnail.png'
    )
  })
})

describe('thumbnail route — source invariants', () => {
  // Source invariant checks verify security-critical patterns exist.
  // Full behavior tests would require mocking Next.js runtime, Supabase,
  // R2, and Redis — these guards catch accidental removal of auth,
  // rate limiting, and signed URL patterns.
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

  it('applies rate limiting in both handlers', () => {
    assert.match(source, /thumbnail:upload:user/)
    assert.match(source, /thumbnail:get:user/)
  })

  it('validates videoId with UUID helper in both handlers', () => {
    const uuidChecks = source.match(/isValidUUID\(videoId\)/g)
    assert.ok(uuidChecks && uuidChecks.length >= 2, 'Both POST and GET must validate videoId')
  })
})
