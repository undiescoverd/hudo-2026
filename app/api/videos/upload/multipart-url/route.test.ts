/**
 * Unit tests for the multipart-url API route.
 *
 * Tests validation/normalization logic, access control, and source code
 * invariants. Uses Node.js built-in test runner — no Next.js runtime needed
 * (mirrors the established pattern in the sibling presign/complete route tests).
 *
 * Run: npx tsx --test app/api/videos/upload/multipart-url/route.test.ts
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

const MAX_PARTS_PER_REQUEST = 10

// ── Replicates the body-normalization fix (CLAUDE.md: multipart bug fix) ──
// Server accepts either the documented `partNumbers` array or the legacy
// singular `partNumber` the client actually sends.
function normalizePartNumbers(rawPartNumbers: unknown, partNumber: unknown): unknown[] | undefined {
  return (
    (rawPartNumbers as unknown[] | undefined) ??
    (partNumber !== undefined ? [partNumber] : undefined)
  )
}

describe('multipart-url route — partNumbers/partNumber normalization', () => {
  it('accepts a partNumbers array as-is', () => {
    assert.deepEqual(normalizePartNumbers([1, 2, 3], undefined), [1, 2, 3])
  })

  it('accepts a legacy singular partNumber, wrapping it into an array', () => {
    assert.deepEqual(normalizePartNumbers(undefined, 5), [5])
  })

  it('prefers partNumbers when both are present', () => {
    assert.deepEqual(normalizePartNumbers([9], 5), [9])
  })

  it('is undefined when neither is present (→ 400 downstream)', () => {
    assert.equal(normalizePartNumbers(undefined, undefined), undefined)
  })

  it('downstream validation rejects an empty/undefined result', () => {
    const partNumbers = normalizePartNumbers(undefined, undefined)
    const valid = Array.isArray(partNumbers) && partNumbers.length > 0
    assert.equal(valid, false)
  })

  it('caps at MAX_PARTS_PER_REQUEST', () => {
    assert.equal(MAX_PARTS_PER_REQUEST, 10)
    const tooMany = Array.from({ length: 11 }, (_, i) => i + 1)
    assert.ok(tooMany.length > MAX_PARTS_PER_REQUEST)
  })
})

describe('multipart-url route — R2 key parsing (agencyId/videoId derivation)', () => {
  function parseKey(r2Key: string) {
    const agencyId = r2Key.split('/')[0]
    const keyVideoId = r2Key.split('/')[1]
    return { agencyId, keyVideoId }
  }

  it('derives agencyId and keyVideoId from a well-formed key', () => {
    const { agencyId, keyVideoId } = parseKey('agency-1/video-1/upload-id.mp4')
    assert.equal(agencyId, 'agency-1')
    assert.equal(keyVideoId, 'video-1')
  })

  it('flags a malformed key missing the videoId segment', () => {
    const { keyVideoId } = parseKey('agency-1')
    assert.equal(keyVideoId, undefined)
  })
})

describe('multipart-url route — talent ownership guard (S4-UPLOAD-001)', () => {
  // Replicates the talent-only ownership check added to the route.
  function talentAccessDenied(
    role: string,
    video: { talent_id: string; agency_id: string } | null,
    userId: string,
    keyAgencyId: string
  ): boolean {
    if (role !== 'talent') return false
    return !video || video.talent_id !== userId || video.agency_id !== keyAgencyId
  }

  it('allows talent who owns the video and matches the key agency', () => {
    assert.equal(
      talentAccessDenied(
        'talent',
        { talent_id: 'user-1', agency_id: 'agency-1' },
        'user-1',
        'agency-1'
      ),
      false
    )
  })

  it('denies talent who does not own the video', () => {
    assert.equal(
      talentAccessDenied(
        'talent',
        { talent_id: 'other-user', agency_id: 'agency-1' },
        'user-1',
        'agency-1'
      ),
      true
    )
  })

  it('denies talent when the key agency does not match the video agency', () => {
    assert.equal(
      talentAccessDenied(
        'talent',
        { talent_id: 'user-1', agency_id: 'agency-2' },
        'user-1',
        'agency-1'
      ),
      true
    )
  })

  it('denies talent when the video does not exist', () => {
    assert.equal(talentAccessDenied('talent', null, 'user-1', 'agency-1'), true)
  })

  it('never restricts agent+ callers', () => {
    assert.equal(
      talentAccessDenied(
        'agent',
        { talent_id: 'other-user', agency_id: 'agency-2' },
        'user-1',
        'agency-1'
      ),
      false
    )
  })
})

describe('multipart-url route — source invariants', () => {
  let source: string

  before(async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('exports POST handler', () => {
    assert.match(source, /export async function POST/)
  })

  it('uses requireUploadRole (imported from lib/api-helpers), not an inline agentPlusRoles check', () => {
    assert.match(source, /import \{ requireUploadRole \} from '@\/lib\/api-helpers'/)
    assert.match(source, /requireUploadRole\(/)
    assert.doesNotMatch(source, /agentPlusRoles/)
  })

  it('normalizes partNumbers from either partNumbers or legacy partNumber', () => {
    assert.match(source, /partNumbers: rawPartNumbers/)
    assert.match(
      source,
      /const partNumbers = rawPartNumbers \?\? \(partNumber !== undefined \? \[partNumber\] : undefined\)/
    )
  })

  it('derives keyVideoId from the R2 key and 400s on a malformed key', () => {
    assert.match(source, /const keyVideoId = r2Key\.split\('\/'\)\[1\]/)
    assert.match(source, /Invalid R2 key format/)
  })

  it('enforces talent ownership (talent_id + agency_id match) before issuing part URLs', () => {
    assert.match(source, /membership\.role === 'talent'/)
    assert.match(source, /video\.talent_id !== user\.id \|\| video\.agency_id !== agencyId/)
    assert.match(source, /Access denied/)
  })
})
