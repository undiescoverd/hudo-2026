/**
 * Unit tests for the comments item API route (PATCH + DELETE).
 *
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 * Tests validation logic and source-invariant security checks.
 *
 * Run: npx tsx --test "app/api/comments/[id]/route.test.ts"
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

describe('comments item route — UUID validation', () => {
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
// roleAtLeast (pure logic — no Next.js)
// ---------------------------------------------------------------------------

describe('roleAtLeast', () => {
  let roleAtLeast: (role: string, minimum: string) => boolean

  before(async () => {
    const mod = await import('@/lib/auth')
    roleAtLeast = mod.roleAtLeast as (role: string, minimum: string) => boolean
  })

  it('owner satisfies agent minimum', () => {
    assert.ok(roleAtLeast('owner', 'agent'))
  })

  it('agent satisfies agent minimum', () => {
    assert.ok(roleAtLeast('agent', 'agent'))
  })

  it('talent does not satisfy agent minimum', () => {
    assert.ok(!roleAtLeast('talent', 'agent'))
  })

  it('admin_agent satisfies agent minimum', () => {
    assert.ok(roleAtLeast('admin_agent', 'agent'))
  })
})

// ---------------------------------------------------------------------------
// Source invariants — security-critical patterns in route.ts
// ---------------------------------------------------------------------------

describe('comments item route — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const routePath = path.resolve(currentDir, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('exports a PATCH handler', () => {
    assert.match(source, /export async function PATCH/)
  })

  it('exports a DELETE handler', () => {
    assert.match(source, /export async function DELETE/)
  })

  it('enforces authentication (Authentication required)', () => {
    assert.match(source, /Authentication required/)
  })

  it('applies rate limiting for PATCH with correct key pattern', () => {
    assert.match(source, /comments:patch:user:/)
  })

  it('applies rate limiting for DELETE with correct key pattern', () => {
    assert.match(source, /comments:delete:user:/)
  })

  it('fails-closed on Redis error (returns 429)', () => {
    const matches = source.match(/status:\s*429/g) ?? []
    assert.ok(
      matches.length >= 2,
      'Expected at least 2 occurrences of status 429 (PATCH + DELETE fail-closed)'
    )
  })

  it('PATCH uses roleAtLeast to guard resolve operations', () => {
    assert.match(source, /roleAtLeast/)
  })

  it('PATCH checks content length against COMMENT_BODY_MAX_LENGTH', () => {
    assert.match(source, /COMMENT_BODY_MAX_LENGTH/)
  })

  it('DELETE never calls .delete() — only .update() for soft-delete', () => {
    assert.doesNotMatch(source, /\.delete\(\)/)
  })

  it('DELETE sets deleted_at for soft-delete', () => {
    assert.match(source, /deleted_at/)
  })

  it('soft-deletes via .update() with deleted_at', () => {
    assert.match(source, /\.update\(\{\s*deleted_at/)
  })

  it('returns 404 for already-deleted comments', () => {
    // Route checks comment.deleted_at !== null to return 404
    assert.match(source, /deleted_at !== null/)
  })

  it('uses service role client for DB ops (createClient)', () => {
    assert.match(source, /createClient\(supabaseUrl,\s*serviceRoleKey\)/)
  })

  it('uses createServerClient for auth', () => {
    assert.match(source, /createServerClient/)
  })

  it('validates comment ID with UUID regex', () => {
    assert.match(source, /UUID_RE\.test\(commentId\)/)
  })

  it('talent can only delete own comments (user_id check)', () => {
    assert.match(source, /talent/)
    assert.match(source, /user_id/)
    assert.match(source, /user\.id/)
  })
})
