/**
 * CommentThread — nesting, the "Comment deleted" placeholder vs hidden, and which
 * comments in a thread offer Reply. Real server renders.
 *
 * Run: npx tsx --test components/comments/CommentThread.test.tsx
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CommentThread as CommentThreadType } from './CommentThread'
import { AUTHOR_ID, OTHER_ID, makeComment } from './comment-fixtures'

const DELETED = '2026-10-23T11:00:00.000Z'

describe('CommentThread (rendered)', () => {
  let CommentThread: typeof CommentThreadType

  before(async () => {
    // tsx compiles JSX to React.createElement; the app's own build injects it.
    ;(globalThis as { React?: unknown }).React = React
    ;({ CommentThread } = await import('./CommentThread'))
  })

  const noop = () => {}
  const noopAsync = async () => {}

  function render(
    parent: ReturnType<typeof makeComment>,
    replies: ReturnType<typeof makeComment>[],
    viewer: { role?: string | null; userId?: string | null } = {}
  ) {
    return renderToStaticMarkup(
      React.createElement(CommentThread, {
        parent,
        replies,
        onSeek: noop,
        viewerRole: viewer.role,
        viewerUserId: viewer.userId,
        onResolve: noopAsync,
        onEdit: noopAsync,
        onDelete: noopAsync,
        // Presence enables Reply; the composer itself only opens on click.
        replyInput: {
          videoId: 'v',
          versionId: 'ver',
          agencyId: 'a',
          userId: viewer.userId ?? '',
          onOptimisticInsert: noop,
          onOptimisticRollback: noop,
        },
      })
    )
  }

  it('nests replies under their parent', () => {
    const parent = makeComment({ content: 'the parent' })
    const reply = makeComment({ parentId: parent.id, content: 'the reply' })
    const html = render(parent, [reply])
    assert.ok(html.indexOf('the parent') < html.indexOf('the reply'))
    assert.match(html, /ml-8/) // replies are indented
  })

  it('a deleted comment WITH replies shows "Comment deleted" and keeps the replies', () => {
    const parent = makeComment({ deletedAt: DELETED, content: 'removed words' })
    const reply = makeComment({ parentId: parent.id, content: 'still here' })
    const html = render(parent, [reply], { role: 'owner', userId: OTHER_ID })
    assert.match(html, />Comment deleted</)
    assert.match(html, /still here/)
    assert.doesNotMatch(html, /removed words/)
  })

  it('the placeholder offers no Reply, and the surviving replies keep their own actions', () => {
    const parent = makeComment({ deletedAt: DELETED })
    const reply = makeComment({ parentId: parent.id, userId: AUTHOR_ID })
    const html = render(parent, [reply], { role: 'talent', userId: AUTHOR_ID })
    assert.doesNotMatch(html, /Reply to/)
    assert.match(html, /Edit comment by/)
    assert.match(html, /Delete comment by/)
  })

  it('a deleted comment WITHOUT replies renders nothing', () => {
    assert.equal(render(makeComment({ deletedAt: DELETED }), []), '')
  })

  it('a deleted comment whose replies are all deleted renders nothing', () => {
    const parent = makeComment({ deletedAt: DELETED })
    assert.equal(render(parent, [makeComment({ parentId: parent.id, deletedAt: DELETED })]), '')
  })

  it('a live comment with only deleted replies renders just the comment', () => {
    const parent = makeComment({ content: 'alone now' })
    const gone = makeComment({ parentId: parent.id, deletedAt: DELETED, content: 'gone reply' })
    const html = render(parent, [gone])
    assert.match(html, /alone now/)
    assert.doesNotMatch(html, /gone reply|Comment deleted/)
  })

  it('Reply appears on the top-level comment only, never on its replies', () => {
    const parent = makeComment({ authorName: 'Parent Person' })
    const reply = makeComment({ parentId: parent.id, authorName: 'Reply Person' })
    const html = render(parent, [reply], { role: 'agent', userId: OTHER_ID })
    assert.match(html, /aria-label="Reply to Parent Person"/)
    assert.doesNotMatch(html, /aria-label="Reply to Reply Person"/)
    assert.equal([...html.matchAll(/>Reply</g)].length, 1)
  })

  it('shows no actions to a viewer without a role', () => {
    const parent = makeComment()
    const html = render(parent, [makeComment({ parentId: parent.id })])
    assert.doesNotMatch(html, /Comment actions|<textarea/)
  })

  it('the reply composer is closed until Reply is clicked', () => {
    const html = render(makeComment(), [], { role: 'agent', userId: OTHER_ID })
    assert.doesNotMatch(html, /<textarea/)
  })
})

describe('CommentThread — wiring (source invariants)', () => {
  let source: string

  before(() => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(dir, 'CommentThread.tsx'), 'utf8')
  })

  it('opens the reply composer for the PARENT, closes it on cancel or after posting', () => {
    assert.match(source, /replyTo=\{parent\}/)
    assert.match(source, /onCancel=\{\(\) => setReplying\(false\)\}/)
    assert.match(source, /onPosted=\{\(\) => setReplying\(false\)\}/)
  })

  it('never offers Reply on the replies (no onReply passed to them)', () => {
    const repliesBlock = source.slice(source.indexOf('visibleReplies(replies).map'))
    assert.doesNotMatch(repliesBlock.split('replying &&')[0], /onReply/)
  })

  it('binds each action to the comment it was rendered for', () => {
    assert.match(source, /onResolve\(comment\.id, resolved\)/)
    assert.match(source, /onEdit\(comment\.id, content\)/)
    assert.match(source, /onDelete\(comment\.id\)/)
  })
})
