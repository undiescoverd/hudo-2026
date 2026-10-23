/**
 * Unit tests for CommentPanel — source invariants (via file inspection).
 *
 * CommentPanel used to self-fetch its comments and subscribe to Realtime
 * directly, which meant the fetched data was invisible to anything else on
 * the page (e.g. VideoPlayer's CommentTimeline markers). It now receives
 * comments/loading/error and mutation handlers as props from the page-level
 * useVideoComments hook, so there is exactly ONE fetch of the comments
 * endpoint shared by both consumers.
 *
 * Run: npx tsx --test "components/comments/CommentPanel.test.tsx"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CommentPanel as CommentPanelType } from './CommentPanel'
import { AUTHOR_ID, OTHER_ID, makeComment } from './comment-fixtures'

describe('CommentPanel — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(currentDir, 'CommentPanel.tsx'), 'utf8')
  })

  it('is a client component', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('exports a CommentPanel component', () => {
    assert.match(source, /export function CommentPanel/)
  })

  it('does not fetch comments itself (comments come in as a prop)', () => {
    assert.doesNotMatch(source, /fetch\(\s*`\/api\/videos\//)
  })

  it('does not subscribe to Realtime itself (owned by the shared hook)', () => {
    assert.doesNotMatch(source, /useRealtimeComments/)
  })

  it('accepts comments, loading, and error as props', () => {
    assert.match(source, /comments: Comment\[\]/)
    assert.match(source, /loading: boolean/)
    assert.match(source, /error: string \| null/)
  })

  it('accepts onOptimisticInsert/onOptimisticRollback as props and forwards them to CommentInput', () => {
    assert.match(source, /onOptimisticInsert: \(comment: Comment\) => void/)
    assert.match(source, /onOptimisticRollback: \(tempId: string\) => void/)
    assert.match(source, /onOptimisticInsert=\{onOptimisticInsert\}/)
    assert.match(source, /onOptimisticRollback=\{onOptimisticRollback\}/)
  })

  it('renders a version-scoped comment count header, excluding soft-deleted comments', () => {
    assert.match(source, /title="Comments on this version"/)
    assert.match(source, /c\.deletedAt === null/)
    assert.match(source, /Comments · \{visibleCount\}/)
  })

  it('forwards the viewer role + user id and the comment actions to each thread', () => {
    assert.match(source, /viewerRole\?: string \| null/)
    assert.match(source, /viewerRole=\{viewerRole\}/)
    assert.match(source, /viewerUserId=\{userId\}/)
    assert.match(source, /onResolve=\{onResolveComment\}/)
    assert.match(source, /onEdit=\{onEditComment\}/)
    assert.match(source, /onDelete=\{onDeleteComment\}/)
  })

  it('decides the empty state from threads that render, not from raw comments', () => {
    assert.match(source, /buildThreads\(comments\)\.filter\(\(t\) => isThreadVisible/)
    assert.match(source, /threads\.length === 0/)
  })
})

describe('CommentPanel (rendered in a real player provider)', () => {
  let CommentPanel: typeof CommentPanelType
  let VideoPlayerProvider: React.ComponentType<{ children: React.ReactNode }>

  before(async () => {
    // tsx compiles JSX to React.createElement; the app's own build injects it.
    ;(globalThis as { React?: unknown }).React = React
    ;({ VideoPlayerProvider } = await import('@/components/player/VideoPlayerProvider'))
    ;({ CommentPanel } = await import('./CommentPanel'))
  })

  const DELETED = '2026-10-23T11:00:00.000Z'
  const EMPTY = /No comments yet\./

  function render(
    comments: ReturnType<typeof makeComment>[],
    over: { viewerRole?: string | null; loading?: boolean; error?: string | null } = {}
  ) {
    return renderToStaticMarkup(
      React.createElement(
        VideoPlayerProvider,
        null,
        React.createElement(CommentPanel, {
          videoId: 'v',
          versionId: 'ver',
          agencyId: 'a',
          userId: AUTHOR_ID,
          comments,
          loading: over.loading ?? false,
          error: over.error ?? null,
          viewerRole: over.viewerRole,
          onOptimisticInsert: () => {},
          onOptimisticRollback: () => {},
          onResolveComment: async () => {},
          onEditComment: async () => {},
          onDeleteComment: async () => {},
        })
      )
    )
  }

  it('shows the empty state and a zero count when there are no comments', () => {
    const html = render([])
    assert.match(html, EMPTY)
    assert.match(html, /Comments · 0/)
  })

  it('the only comment is soft-deleted -> empty state, count 0 (not a blank panel)', () => {
    const html = render([makeComment({ deletedAt: DELETED, content: 'removed words' })])
    assert.match(html, EMPTY)
    assert.match(html, /Comments · 0/)
    assert.doesNotMatch(html, /removed words|Comment deleted/)
  })

  it('the only comment and all its replies are soft-deleted -> empty state', () => {
    const parent = makeComment({ deletedAt: DELETED })
    const reply = makeComment({ parentId: parent.id, deletedAt: DELETED })
    assert.match(render([parent, reply]), EMPTY)
  })

  it('a deleted comment that has a live reply is NOT an empty panel: placeholder + reply', () => {
    const parent = makeComment({ deletedAt: DELETED, content: 'removed words' })
    const reply = makeComment({ parentId: parent.id, content: 'surviving reply' })
    const html = render([parent, reply])
    assert.doesNotMatch(html, EMPTY)
    assert.match(html, />Comment deleted</)
    assert.match(html, /surviving reply/)
    assert.doesNotMatch(html, /removed words/)
    assert.match(html, /Comments · 1/)
  })

  it('after a reload (GET omits the deleted parent) its replies still show under "Comment deleted"', () => {
    const reply = makeComment({
      parentId: 'c0000000-0000-4000-8000-00000000dead',
      content: 'orphaned reply',
    })
    const html = render([reply])
    assert.doesNotMatch(html, EMPTY)
    assert.match(html, />Comment deleted</)
    assert.match(html, /orphaned reply/)
  })

  it('with other live comments, a deleted one without replies is simply absent', () => {
    const html = render([
      makeComment({ deletedAt: DELETED, content: 'removed words' }),
      makeComment({ content: 'kept comment' }),
    ])
    assert.doesNotMatch(html, EMPTY)
    assert.match(html, /kept comment/)
    assert.doesNotMatch(html, /removed words|Comment deleted/)
    assert.match(html, /Comments · 1/)
  })

  it('does not show the empty state while loading or on error', () => {
    assert.doesNotMatch(render([], { loading: true }), EMPTY)
    const html = render([], { error: 'Failed to load comments (500)' })
    assert.doesNotMatch(html, EMPTY)
    assert.match(html, /Failed to load comments/)
  })

  it('threads render in order: top-level by timestamp, replies nested under their parent', () => {
    const late = makeComment({ timestampSeconds: 30, content: 'late one' })
    const early = makeComment({ timestampSeconds: 5, content: 'early one' })
    const reply = makeComment({ parentId: early.id, content: 'reply to early' })
    const html = render([late, reply, early])
    assert.ok(html.indexOf('early one') < html.indexOf('reply to early'))
    assert.ok(html.indexOf('reply to early') < html.indexOf('late one'))
  })

  it("passes the viewer's role and id through: the author edits, an agent resolves", () => {
    const mine = makeComment({ userId: AUTHOR_ID, authorName: 'Me Myself' })
    const theirs = makeComment({ userId: OTHER_ID, authorName: 'Someone Else' })

    const asTalent = render([mine, theirs], { viewerRole: 'talent' })
    assert.match(asTalent, /aria-label="Edit comment by Me Myself"/)
    assert.doesNotMatch(asTalent, /aria-label="Edit comment by Someone Else"/)
    assert.doesNotMatch(asTalent, /Resolve comment by/)

    const asAgent = render([mine, theirs], { viewerRole: 'agent' })
    assert.match(asAgent, /aria-label="Resolve comment by Someone Else"/)
    assert.match(asAgent, /aria-label="Delete comment by Someone Else"/)
    assert.doesNotMatch(asAgent, /aria-label="Edit comment by Someone Else"/)
  })

  it('without a viewer role no comment shows any action', () => {
    const html = render([makeComment({ userId: AUTHOR_ID })])
    assert.doesNotMatch(html, /Comment actions/)
  })
})
