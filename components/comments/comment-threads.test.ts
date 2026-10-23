/**
 * Grouping comments into threads, and which threads render.
 *
 * Run: npx tsx --test components/comments/comment-threads.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildThreads, isThreadVisible, visibleReplies } from './comment-threads'
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

describe('thread visibility', () => {
  it('visibleReplies drops deleted replies', () => {
    const live = makeComment({ parentId: 'p' })
    const gone = makeComment({ parentId: 'p', deletedAt: DELETED })
    assert.deepEqual(visibleReplies([live, gone]), [live])
  })

  it('a live parent is always visible', () => {
    assert.equal(isThreadVisible(makeComment(), []), true)
  })

  it('a deleted parent with a live reply is visible (placeholder + replies)', () => {
    const parent = makeComment({ deletedAt: DELETED })
    assert.equal(isThreadVisible(parent, [makeComment({ parentId: parent.id })]), true)
  })

  it('a deleted parent with no replies is hidden', () => {
    assert.equal(isThreadVisible(makeComment({ deletedAt: DELETED }), []), false)
  })

  it('a deleted parent whose replies are all deleted is hidden', () => {
    const parent = makeComment({ deletedAt: DELETED })
    const replies = [makeComment({ parentId: parent.id, deletedAt: DELETED })]
    assert.equal(isThreadVisible(parent, replies), false)
  })
})
