/**
 * Unit tests for /api/notifications (GET + PATCH collection).
 *
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 * Tests validation logic, source invariants, and pure helpers.
 *
 * Run: npx tsx --test "app/api/notifications/route.test.ts"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

// ---------------------------------------------------------------------------
// Source invariants — security-critical patterns in route.ts
// ---------------------------------------------------------------------------

describe('notifications collection route — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const routePath = path.resolve(currentDir, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('uses recipient_id (not user_id) as the filter column', () => {
    assert.ok(
      source.includes("eq('recipient_id', user.id)"),
      "GET/PATCH must filter by 'recipient_id'"
    )
  })

  it('caps GET results at 50 rows', () => {
    assert.ok(source.includes('.limit(50)'), 'GET must apply .limit(50)')
  })

  it('orders results by created_at descending (newest first)', () => {
    assert.ok(
      source.includes("order('created_at', { ascending: false })"),
      'GET must order newest-first'
    )
  })

  it('mark-all PATCH uses .is(read_at, null) to only update unread rows', () => {
    assert.ok(
      source.includes(".is('read_at', null)"),
      'Mark-all-read must filter to unread rows only'
    )
  })

  it('unread count uses head:true for efficiency', () => {
    assert.ok(
      source.includes('head: true'),
      'Unread count query must use head:true to avoid fetching row data'
    )
  })

  it('does not expose service role key to client', () => {
    assert.ok(
      !source.includes('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE'),
      'Service role key must never be NEXT_PUBLIC_'
    )
  })

  it('requires authentication (401 guard present)', () => {
    assert.ok(source.includes('status: 401'), 'Route must return 401 for unauthenticated requests')
  })

  it('rate limits are applied to GET', () => {
    assert.ok(source.includes('notifications:get:user:'), 'GET must apply per-user rate limiting')
  })

  it('rate limits are applied to PATCH', () => {
    assert.ok(
      source.includes('notifications:patch-all:user:'),
      'PATCH must apply per-user rate limiting'
    )
  })
})
