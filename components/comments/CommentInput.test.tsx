import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { validateCreateInput } from '@/lib/comments'
import type {
  CommentInput as CommentInputType,
  buildCommentPayload as BuildPayload,
  buildOptimisticComment as BuildOptimistic,
  resolveCommentTarget as ResolveTarget,
} from './CommentInput'
import { makeComment } from './comment-fixtures'

describe('CommentInput — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.resolve(currentDir, 'CommentInput.tsx')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('is a client component', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('exports a CommentInput component', () => {
    assert.match(source, /export function CommentInput/)
  })

  it('uses useVideoPlayerContext for timestamp/range', () => {
    assert.match(source, /useVideoPlayerContext/)
  })

  it('enforces a 2000 character limit', () => {
    assert.match(source, /COMMENT_BODY_MAX_LENGTH|2000/)
  })

  it('uses the shared key handling (Enter sends, Shift+Enter newline, Escape cancels a reply)', () => {
    assert.match(source, /editKeyAction\(e\.key, e\.shiftKey\)/)
  })

  it('posts to the comments collection endpoint', () => {
    assert.match(source, /\/api\/videos\/.*\/versions\/.*\/comments/)
  })

  it('uses crypto.randomUUID for optimistic temp ids', () => {
    assert.match(source, /crypto\.randomUUID|temp-/)
  })

  it('calls onOptimisticRollback in both success and error paths', () => {
    const matches = [...source.matchAll(/onOptimisticRollback\(tempId\)/g)]
    assert.equal(matches.length, 2, 'rollback must be called in both success and error paths')
  })

  it('calls onOptimisticInsert twice (temp + canonical) on success', () => {
    const insertMatches = [...source.matchAll(/onOptimisticInsert\(/g)]
    assert.equal(
      insertMatches.length,
      2,
      'onOptimisticInsert must be called twice: once for temp, once for canonical'
    )
  })

  it('parses POST response JSON', () => {
    assert.match(source, /res\.json\(\)/)
  })

  it('disables submit when body is empty after trim', () => {
    assert.match(source, /\.trim\(\)/)
  })
})

describe('CommentInput — accessibility invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.resolve(currentDir, 'CommentInput.tsx')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('error message has role="alert" for screen readers', () => {
    assert.match(source, /role="alert"/)
  })
})

describe('buildCommentPayload', () => {
  let buildCommentPayload: typeof BuildPayload

  before(async () => {
    ;(globalThis as { React?: unknown }).React = React
    ;({ buildCommentPayload } = await import('./CommentInput'))
  })

  it('a top-level comment sends no parent_id', () => {
    const payload = buildCommentPayload({
      content: 'Hello',
      commentType: 'point',
      startSec: 12.5,
      endSec: null,
      parentId: null,
    })
    assert.deepEqual(payload, { content: 'Hello', comment_type: 'point', timestamp_seconds: 12.5 })
    assert.ok(!('parent_id' in payload))
  })

  it('a range comment sends end_timestamp_seconds', () => {
    const payload = buildCommentPayload({
      content: 'Range',
      commentType: 'range',
      startSec: 5,
      endSec: 9,
      parentId: null,
    })
    assert.equal(payload.end_timestamp_seconds, 9)
  })

  it('a reply sends parent_id, and the server-side validator accepts the body', () => {
    const parentId = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890'
    const payload = buildCommentPayload({
      content: 'Agreed',
      commentType: 'point',
      startSec: 12.5,
      endSec: null,
      parentId,
    })
    assert.equal(payload.parent_id, parentId)
    const parsed = validateCreateInput(payload)
    assert.ok(typeof parsed !== 'string', `rejected: ${parsed}`)
    assert.equal((parsed as { parent_id?: string }).parent_id, parentId)
  })
})

describe('resolveCommentTarget', () => {
  let resolveCommentTarget: typeof ResolveTarget

  before(async () => {
    ;(globalThis as { React?: unknown }).React = React
    ;({ resolveCommentTarget } = await import('./CommentInput'))
  })

  const player = { rangeIn: null, rangeOut: null, currentTime: 42.5 }

  it('a plain comment is a point at the current time', () => {
    assert.deepEqual(resolveCommentTarget({ replyTo: null, ...player }), {
      commentType: 'point',
      startSec: 42.5,
      endSec: null,
      parentId: null,
    })
  })

  it('a comment with both range marks set in order is a range', () => {
    assert.deepEqual(
      resolveCommentTarget({ replyTo: null, rangeIn: 10, rangeOut: 20, currentTime: 42.5 }),
      { commentType: 'range', startSec: 10, endSec: 20, parentId: null }
    )
  })

  it('a missing or out-of-order range falls back to a point at the current time', () => {
    for (const [rangeIn, rangeOut] of [
      [10, null],
      [null, 20],
      [20, 10],
      [15, 15],
    ] as const) {
      const target = resolveCommentTarget({ replyTo: null, rangeIn, rangeOut, currentTime: 42.5 })
      assert.equal(target.commentType, 'point', `${rangeIn}-${rangeOut}`)
      assert.equal(target.startSec, 42.5)
      assert.equal(target.endSec, null)
    }
  })

  it("a reply is a point at its parent's timestamp, with the parent id", () => {
    const parent = makeComment({ timestampSeconds: 83 })
    assert.deepEqual(resolveCommentTarget({ replyTo: parent, ...player }), {
      commentType: 'point',
      startSec: 83,
      endSec: null,
      parentId: parent.id,
    })
  })

  it("a reply ignores the player's range and current time", () => {
    const parent = makeComment({ timestampSeconds: 83 })
    const target = resolveCommentTarget({
      replyTo: parent,
      rangeIn: 10,
      rangeOut: 20,
      currentTime: 42.5,
    })
    assert.equal(target.commentType, 'point')
    assert.equal(target.startSec, 83)
    assert.equal(target.endSec, null)
  })

  it('a reply to a range comment still uses only its start', () => {
    const parent = makeComment({
      commentType: 'range',
      timestampSeconds: 5,
      endTimestampSeconds: 9,
    })
    const target = resolveCommentTarget({ replyTo: parent, ...player })
    assert.deepEqual([target.commentType, target.startSec, target.endSec], ['point', 5, null])
  })
})

describe('buildOptimisticComment', () => {
  let buildOptimisticComment: typeof BuildOptimistic

  before(async () => {
    ;(globalThis as { React?: unknown }).React = React
    ;({ buildOptimisticComment } = await import('./CommentInput'))
  })

  const common = {
    tempId: 'temp-1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed',
    nowIso: '2026-10-23T12:00:00.000Z',
    versionId: 'ver',
    agencyId: 'agency',
    userId: 'me',
    content: 'Agreed',
    authorName: 'Me Myself',
  }

  it('a reply carries its parent id and the parent timestamp, so it nests at once', () => {
    const comment = buildOptimisticComment({
      ...common,
      commentType: 'point',
      startSec: 83,
      endSec: null,
      parentId: 'parent-1',
    })
    assert.equal(comment.parentId, 'parent-1')
    assert.equal(comment.timestampSeconds, 83)
    assert.equal(comment.id, common.tempId)
    assert.equal(comment.authorName, 'Me Myself')
  })

  it('a top-level comment has no parent and starts unresolved and undeleted', () => {
    const comment = buildOptimisticComment({
      ...common,
      commentType: 'range',
      startSec: 5,
      endSec: 9,
      parentId: null,
    })
    assert.equal(comment.parentId, null)
    assert.equal(comment.endTimestampSeconds, 9)
    assert.equal(comment.resolved, false)
    assert.equal(comment.deletedAt, null)
    assert.equal(comment.createdAt, common.nowIso)
  })
})

describe('CommentInput — reply composer (rendered)', () => {
  let CommentInput: typeof CommentInputType
  let VideoPlayerProvider: React.ComponentType<{ children: React.ReactNode }>

  before(async () => {
    ;(globalThis as { React?: unknown }).React = React
    ;({ VideoPlayerProvider } = await import('@/components/player/VideoPlayerProvider'))
    ;({ CommentInput } = await import('./CommentInput'))
  })

  function render(extra: Record<string, unknown>) {
    return renderToStaticMarkup(
      React.createElement(
        VideoPlayerProvider,
        null,
        React.createElement(CommentInput, {
          videoId: 'v',
          versionId: 'ver',
          agencyId: 'a',
          userId: 'u',
          onOptimisticInsert: () => {},
          onOptimisticRollback: () => {},
          ...extra,
        })
      )
    )
  }

  it('without replyTo it is the normal composer: timecode chip, "Comment" label, Post', () => {
    const html = render({})
    assert.match(html, /aria-label="Comment"/)
    assert.match(html, />point</)
    assert.match(html, />Post</)
    assert.doesNotMatch(html, /Reply|Cancel/)
  })

  it('with replyTo it names who it replies to, has no timecode chip, and offers Reply + Cancel', () => {
    const parent = makeComment({ authorName: 'Alex Author', timestampSeconds: 83 })
    const html = render({ replyTo: parent, onCancel: () => {} })
    assert.match(html, /aria-label="Reply to Alex Author"/)
    assert.match(html, />Reply to Alex Author</)
    assert.match(html, />Reply</)
    assert.match(html, />Cancel</)
    assert.doesNotMatch(html, />point<|>range<|>Post</)
  })
})
