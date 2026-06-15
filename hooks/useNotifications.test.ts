/**
 * Unit tests for useNotifications helpers.
 *
 * Tests pure exported functions only — the hook itself requires a browser
 * environment (Realtime + fetch) which is not available in Node test runner.
 *
 * Run: npx tsx --test "hooks/useNotifications.test.ts"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

// ---------------------------------------------------------------------------
// Pure helper imports
// ---------------------------------------------------------------------------

// Dynamic import deferred to before() so ESM resolution works with tsx
let notificationHref: (n: { video_id: string | null }) => string
let capAt50: <T>(items: T[]) => T[]
let countUnread: (notifications: Array<{ read_at: string | null }>) => number

describe('useNotifications pure helpers', () => {
  before(async () => {
    const mod = await import('./useNotifications.js')
    notificationHref = mod.notificationHref
    capAt50 = mod.capAt50
    countUnread = mod.countUnread as (notifications: Array<{ read_at: string | null }>) => number
  })

  // notificationHref
  it('notificationHref: returns /videos/:id when video_id is present', () => {
    const href = notificationHref({ video_id: 'abc-123' })
    assert.equal(href, '/videos/abc-123')
  })

  it('notificationHref: returns /dashboard when video_id is null', () => {
    const href = notificationHref({ video_id: null })
    assert.equal(href, '/dashboard')
  })

  // capAt50
  it('capAt50: returns array unchanged when length <= 50', () => {
    const arr = Array.from({ length: 50 }, (_, i) => i)
    assert.equal(capAt50(arr).length, 50)
  })

  it('capAt50: trims array to 50 when length > 50', () => {
    const arr = Array.from({ length: 75 }, (_, i) => i)
    const result = capAt50(arr)
    assert.equal(result.length, 50)
    // First 50 preserved (newest-first ordering intact)
    assert.equal(result[0], 0)
    assert.equal(result[49], 49)
  })

  it('capAt50: handles empty array', () => {
    assert.deepEqual(capAt50([]), [])
  })

  // countUnread
  it('countUnread: returns 0 for empty list', () => {
    assert.equal(countUnread([]), 0)
  })

  it('countUnread: counts only items with read_at = null', () => {
    const items = [{ read_at: null }, { read_at: '2026-06-16T00:00:00Z' }, { read_at: null }]
    assert.equal(countUnread(items), 2)
  })

  it('countUnread: returns 0 when all are read', () => {
    const items = [{ read_at: '2026-06-16T00:00:00Z' }, { read_at: '2026-06-16T01:00:00Z' }]
    assert.equal(countUnread(items), 0)
  })
})

// ---------------------------------------------------------------------------
// Source invariants for the hook
// ---------------------------------------------------------------------------

describe('useNotifications hook — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const hookPath = path.resolve(currentDir, 'useNotifications.ts')
    source = fs.readFileSync(hookPath, 'utf8')
  })

  it('subscribes with recipient_id filter (not user_id)', () => {
    assert.ok(
      source.includes('recipient_id=eq.${userId}'),
      'Realtime filter must use recipient_id column'
    )
  })

  it('channel is scoped per-user (notifications:{userId})', () => {
    assert.ok(source.includes('`notifications:${userId}`'), 'Channel name must be scoped per-user')
  })

  it('removes channel on cleanup (removeChannel called)', () => {
    assert.ok(
      source.includes('supabase.removeChannel(channel)'),
      'useEffect cleanup must remove the Realtime channel'
    )
  })

  it('resolves user id before subscribing', () => {
    // userId must be resolved first; the subscription uses userIdRef.current
    assert.ok(
      source.includes('userIdRef.current'),
      'User id must be tracked before subscribing to avoid filter race condition'
    )
  })

  it('fetches /api/notifications for initial load', () => {
    assert.ok(
      source.includes("fetch('/api/notifications')"),
      'Hook must fetch from /api/notifications'
    )
  })

  it('uses PATCH for mark-all-read', () => {
    assert.ok(
      source.includes("method: 'PATCH'") && source.includes("fetch('/api/notifications'"),
      'markAllRead must PATCH /api/notifications'
    )
  })

  it('uses PATCH /api/notifications/:id for single mark-read', () => {
    assert.ok(
      source.includes('`/api/notifications/${id}`'),
      'markRead must PATCH /api/notifications/:id'
    )
  })
})
