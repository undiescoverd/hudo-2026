/**
 * Grouping comments into threads, and which threads render.
 *
 * Run: npx tsx --test components/comments/comment-threads.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildThreads } from './comment-threads'
import { makeComment } from './comment-fixtures'

const DELETED = '2026-10-23T11:00:00.000Z'

describe('buildThreads', () => {
  it('orders top-level comments by timestamp and replies by creation time', () => {
    const late = makeComment({ timestampSeconds: 30 })
    const early = makeComment({ timestampSeconds: 5 })
    const second = makeComment({
      parentId: early.id,
      timestampSeconds: 5,
      createdAt: '2026-10-23T10:05:00.000Z',
    })
    const first = makeComment({
      parentId: early.id,
      timestampSeconds: 5,
      createdAt: '2026-10-23T10:01:00.000Z',
    })

    const threads = buildThreads([late, second, early, first])

    assert.deepEqual(
      threads.map((t) => t.parent.id),
      [early.id, late.id]
    )
    assert.deepEqual(
      threads[0].replies.map((r) => r.id),
      [first.id, second.id]
    )
    assert.deepEqual(threads[1].replies, [])
  })

  it('compares creation times as instants, across Postgres and JS timestamp formats', () => {
    const parent = makeComment()
    const pg = makeComment({ parentId: parent.id, createdAt: '2026-10-23T10:00:00.500000+00:00' })
    const js = makeComment({ parentId: parent.id, createdAt: '2026-10-23T10:00:00.100Z' })
    assert.deepEqual(
      buildThreads([parent, pg, js])[0].replies.map((r) => r.id),
      [js.id, pg.id]
    )
  })

  it('keeps a deleted parent that is still in the list (the live, Realtime case)', () => {
    const parent = makeComment({ deletedAt: DELETED })
    const reply = makeComment({ parentId: parent.id })
    const [thread] = buildThreads([parent, reply])
    assert.equal(thread.parent, parent)
    assert.deepEqual(thread.replies, [reply])
  })

  it('rebuilds a "deleted" parent for replies whose parent GET no longer returns', () => {
    // GET /comments omits soft-deleted rows, so after a reload the parent is gone
    // while its replies are still sent.
    const missingParentId = 'c0000000-0000-4000-8000-00000000dead'
    const a = makeComment({
      parentId: missingParentId,
      timestampSeconds: 12,
      createdAt: '2026-10-23T10:01:00.000Z',
    })
    const b = makeComment({
      parentId: missingParentId,
      timestampSeconds: 12,
      createdAt: '2026-10-23T10:02:00.000Z',
    })
    const other = makeComment({ timestampSeconds: 40 })

    const threads = buildThreads([other, b, a])

    assert.equal(threads.length, 2)
    const [orphan, normal] = threads
    assert.equal(orphan.parent.id, missingParentId)
    assert.notEqual(orphan.parent.deletedAt, null)
    assert.equal(orphan.parent.parentId, null)
    assert.equal(orphan.parent.timestampSeconds, 12) // placed by its replies
    assert.deepEqual(
      orphan.replies.map((r) => r.id),
      [a.id, b.id]
    )
    assert.equal(normal.parent.id, other.id)
  })

  it('returns no threads for no comments', () => {
    assert.deepEqual(buildThreads([]), [])
  })
})

describe('buildThreads — only visible threads, with live replies', () => {
  it('drops deleted replies from a live parent', () => {
    const parent = makeComment({ content: 'alone now' })
    const live = makeComment({ parentId: parent.id })
    const gone = makeComment({ parentId: parent.id, deletedAt: DELETED })
    const [thread] = buildThreads([parent, live, gone])
    assert.deepEqual(thread.replies, [live])
  })

  it('keeps a live parent even when every reply is deleted', () => {
    const parent = makeComment()
    const gone = makeComment({ parentId: parent.id, deletedAt: DELETED })
    const threads = buildThreads([parent, gone])
    assert.equal(threads.length, 1)
    assert.deepEqual(threads[0].replies, [])
  })

  it('keeps a deleted parent that has a live reply (placeholder + replies)', () => {
    const parent = makeComment({ deletedAt: DELETED })
    const reply = makeComment({ parentId: parent.id })
    const threads = buildThreads([parent, reply])
    assert.equal(threads.length, 1)
    assert.equal(threads[0].parent, parent)
    assert.deepEqual(threads[0].replies, [reply])
  })

  it('drops a deleted parent with no replies', () => {
    assert.deepEqual(buildThreads([makeComment({ deletedAt: DELETED })]), [])
  })

  it('drops a deleted parent whose replies are all deleted', () => {
    const parent = makeComment({ deletedAt: DELETED })
    const reply = makeComment({ parentId: parent.id, deletedAt: DELETED })
    assert.deepEqual(buildThreads([parent, reply]), [])
  })

  it('drops an orphan group whose replies are all deleted (nothing to show after a reload)', () => {
    const gone = makeComment({
      parentId: 'c0000000-0000-4000-8000-00000000dead',
      deletedAt: DELETED,
    })
    assert.deepEqual(buildThreads([gone]), [])
  })

  it('an empty result is what the panel treats as "No comments yet"', () => {
    const only = makeComment({ deletedAt: DELETED })
    assert.equal(buildThreads([only]).length, 0)
  })
})

describe('buildThreads — ordering', () => {
  it('breaks timestamp ties by creation time, whatever order the list is in', () => {
    const first = makeComment({ timestampSeconds: 20, createdAt: '2026-10-23T10:01:00.000Z' })
    const second = makeComment({ timestampSeconds: 20, createdAt: '2026-10-23T10:02:00.000Z' })
    const third = makeComment({ timestampSeconds: 20, createdAt: '2026-10-23T10:03:00.000Z' })
    for (const input of [
      [first, second, third],
      [third, first, second],
      [second, third, first],
    ]) {
      assert.deepEqual(
        buildThreads(input).map((t) => t.parent.id),
        [first.id, second.id, third.id]
      )
    }
  })
})
