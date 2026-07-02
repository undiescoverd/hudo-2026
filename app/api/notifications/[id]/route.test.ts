/**
 * Unit tests for /api/notifications/[id] (PATCH single mark-read).
 *
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 * Tests UUID validation and source invariants.
 *
 * Run: npx tsx --test "app/api/notifications/[id]/route.test.ts"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

// ---------------------------------------------------------------------------
// UUID validation (mirrors the shared isValidUUID/UUID_RE in lib/validation.ts,
// which route.ts now uses instead of a local copy)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('notifications item route — UUID validation', () => {
  it('accepts a valid UUID', () => {
    assert.ok(UUID_RE.test('a1b2c3d4-e5f6-7890-abcd-ef1234567890'))
  })

  it('rejects a malformed UUID', () => {
    assert.ok(!UUID_RE.test('not-a-uuid'))
  })

  it('rejects SQL injection', () => {
    assert.ok(!UUID_RE.test("'; DROP TABLE notifications; --"))
  })

  it('rejects an empty string', () => {
    assert.ok(!UUID_RE.test(''))
  })
})

// ---------------------------------------------------------------------------
// Source invariants — security-critical patterns in route.ts
// ---------------------------------------------------------------------------

describe('notifications item route — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const routePath = path.resolve(currentDir, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('scopes update to recipient_id = user.id (authorization check)', () => {
    assert.ok(
      source.includes("eq('recipient_id', user.id)"),
      "PATCH must scope to recipient_id=user.id so users can't mark others' notifications read"
    )
  })

  it('scopes update to the specific notification id', () => {
    assert.ok(source.includes("eq('id', notificationId)"), 'PATCH must filter by notification id')
  })

  it('returns 404 on zero rows (no information leakage about other users)', () => {
    assert.ok(
      source.includes('status: 404'),
      'PATCH must return 404 when notification not found or unauthorized'
    )
  })

  it('requires authentication (401 guard present)', () => {
    assert.ok(source.includes('status: 401'), 'Route must return 401 for unauthenticated requests')
  })

  it('validates UUID format (400 guard present)', () => {
    assert.ok(source.includes('isValidUUID('), 'Route must validate UUID format')
  })

  it('rate limits are applied', () => {
    assert.ok(
      source.includes('notifications:patch:user:'),
      'PATCH must apply per-user rate limiting'
    )
  })

  it('does not expose service role key to client', () => {
    assert.ok(
      !source.includes('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE'),
      'Service role key must never be NEXT_PUBLIC_'
    )
  })
})
