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

  it('handles Enter to submit and Shift+Enter for newline', () => {
    assert.match(source, /Shift/)
    assert.match(source, /'Enter'|"Enter"/)
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

describe('CommentInput — comment_type derivation invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.resolve(currentDir, 'CommentInput.tsx')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('emits range when both rangeIn and rangeOut are set', () => {
    assert.match(source, /'range'|"range"/)
    assert.match(source, /rangeIn/)
    assert.match(source, /rangeOut/)
  })

  it('emits point otherwise', () => {
    assert.match(source, /'point'|"point"/)
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

describe('CommentInput — reply wiring (source invariants)', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(currentDir, 'CommentInput.tsx'), 'utf8')
  })

  it('posts through buildCommentPayload with the parent id', () => {
    assert.match(
      source,
      /buildCommentPayload\(\{ content: trimmed, commentType, startSec, endSec, parentId \}\)/
    )
    assert.match(source, /const parentId = replyTo\?\.id \?\? null/)
  })

  it('the optimistic reply carries the parent id so it nests immediately', () => {
    assert.match(source, /endTimestampSeconds: endSec,\s*parentId,/)
    assert.doesNotMatch(source, /parentId: null,/)
  })

  it('a reply takes the parent timestamp as a point comment, ignoring the player range', () => {
    assert.match(source, /replyTo\.timestampSeconds/)
    assert.match(source, /const hasRange =\s*!isReply &&/)
  })

  it('tells the thread when the reply posted, and cancels on Escape', () => {
    assert.match(source, /onPosted\?\.\(\)/)
    assert.match(source, /e\.key === 'Escape' && onCancel/)
  })
})
