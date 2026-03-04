/**
 * Unit tests for the comments collection API route.
 *
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 * Tests validation logic and source-invariant security checks.
 *
 * Run: npx tsx --test "app/api/videos/[videoId]/versions/[versionId]/comments/route.test.ts"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

// ---------------------------------------------------------------------------
// UUID validation (mirrors UUID_RE in route.ts)
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

  it('fails-closed on Redis error (returns 429)', () => {
    const matches = source.match(/status:\s*429/g) ?? []
    assert.ok(
      matches.length >= 2,
      'Expected at least 2 occurrences of status 429 (GET + POST fail-closed)'
    )
  })

  it('filters soft-deleted comments (.is deleted_at null)', () => {
    assert.match(source, /\.is\('deleted_at',\s*null\)/)
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

  it('uses service role client for DB ops (createClient)', () => {
    assert.match(source, /createClient\(supabaseUrl,\s*serviceRoleKey\)/)
  })

  it('uses createServerClient for auth', () => {
    assert.match(source, /createServerClient/)
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
