/**
 * Unit tests for CommentItem — source invariants (via file inspection) plus real
 * server renders for the action permissions and the deleted/resolved states.
 *
 * Run: npx tsx --test "components/comments/CommentItem.test.tsx"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CommentItem as CommentItemType } from './CommentItem'
import { AUTHOR_ID, OTHER_ID, makeComment } from './comment-fixtures'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('CommentItem — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(currentDir, 'CommentItem.tsx'), 'utf8')
  })

  it('is a client component', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('exports a CommentItem component', () => {
    assert.match(source, /export function CommentItem/)
  })

  it('imports formatTimecode and formatRelativeTime from the shared util', () => {
    assert.match(source, /formatTimecode/)
    assert.match(source, /formatRelativeTime/)
    assert.match(source, /from '@\/lib\/format-time'/)
  })

  it('renders comment.authorName', () => {
    assert.match(source, /comment\.authorName/)
  })

  it('renders a relative-time label from comment.createdAt', () => {
    assert.match(source, /formatRelativeTime\(comment\.createdAt\)/)
  })

  it('keeps the timestamp badge as a click-to-seek button', () => {
    assert.match(source, /onClick={\(\) => onSeek\(comment\.timestampSeconds\)}/)
    assert.match(source, /Seek to \$\{formatTimecode\(comment\.timestampSeconds\)\}/)
  })

  it('falls back to a UUID-derived avatar when authorName is absent', () => {
    assert.match(source, /userInitials\(comment\.userId\)/)
  })
})

// ---------------------------------------------------------------------------
// Rendering: which actions each viewer sees
// ---------------------------------------------------------------------------

describe('CommentItem — rendered actions (permission matrix)', () => {
  let CommentItem: typeof CommentItemType

  before(async () => {
    // tsx compiles JSX to React.createElement; the app's own build injects it.
    ;(globalThis as { React?: unknown }).React = React
    ;({ CommentItem } = await import('./CommentItem'))
  })

  const noop = () => {}
  const noopAsync = async () => {}

  function render(
    over: Parameters<typeof makeComment>[0],
    viewer: { role?: string | null; userId?: string | null },
    handlers = true
  ) {
    return renderToStaticMarkup(
      React.createElement(CommentItem, {
        comment: makeComment(over),
        onSeek: noop,
        isReply: !!over?.parentId,
        viewerRole: viewer.role,
        viewerUserId: viewer.userId,
        ...(handlers
          ? { onReply: noop, onResolve: noopAsync, onEdit: noopAsync, onDelete: noopAsync }
          : {}),
      })
    )
  }

  /** Which of Reply / Resolve|Unresolve / Edit / Delete are rendered as buttons. */
  function actions(html: string) {
    const has = (label: RegExp) => label.test(html)
    return {
      reply: has(/aria-label="Reply to Alex Author"/),
      resolve: has(/aria-label="Resolve comment by Alex Author"/),
      unresolve: has(/aria-label="Unresolve comment by Alex Author"/),
      edit: has(/aria-label="Edit comment by Alex Author"/),
      delete: has(/aria-label="Delete comment by Alex Author"/),
    }
  }

  it('talent author: Reply, Edit, Delete; no Resolve', () => {
    assert.deepEqual(actions(render({}, { role: 'talent', userId: AUTHOR_ID })), {
      reply: true,
      resolve: false,
      unresolve: false,
      edit: true,
      delete: true,
    })
  })

  it('talent non-author: Reply only', () => {
    assert.deepEqual(actions(render({}, { role: 'talent', userId: OTHER_ID })), {
      reply: true,
      resolve: false,
      unresolve: false,
      edit: false,
      delete: false,
    })
  })

  it('agent (not the author): Reply, Resolve, Delete; no Edit', () => {
    assert.deepEqual(actions(render({}, { role: 'agent', userId: OTHER_ID })), {
      reply: true,
      resolve: true,
      unresolve: false,
      edit: false,
      delete: true,
    })
  })

  it('owner (not the author): Reply, Resolve, Delete; no Edit', () => {
    assert.deepEqual(actions(render({}, { role: 'owner', userId: OTHER_ID })), {
      reply: true,
      resolve: true,
      unresolve: false,
      edit: false,
      delete: true,
    })
  })

  it('agent who is the author gets all four', () => {
    assert.deepEqual(actions(render({}, { role: 'agent', userId: AUTHOR_ID })), {
      reply: true,
      resolve: true,
      unresolve: false,
      edit: true,
      delete: true,
    })
  })

  it('no role (guest / not loaded): no actions at all, not even the group', () => {
    for (const viewer of [{}, { role: null, userId: AUTHOR_ID }, { role: 'agent', userId: null }]) {
      const html = render({}, viewer)
      assert.deepEqual(actions(html), {
        reply: false,
        resolve: false,
        unresolve: false,
        edit: false,
        delete: false,
      })
      assert.doesNotMatch(html, /Comment actions/)
    }
  })

  it('omitting the props entirely renders read-only (how the guest view would use it)', () => {
    const html = renderToStaticMarkup(
      React.createElement(CommentItem, { comment: makeComment(), onSeek: noop })
    )
    assert.doesNotMatch(html, /Comment actions/)
    assert.match(html, /Comment body/)
  })

  it('a permitted action without its handler is not rendered', () => {
    const html = render({}, { role: 'owner', userId: AUTHOR_ID }, false)
    assert.doesNotMatch(html, /Comment actions/)
  })

  it('Reply is not offered on a reply, but the other actions are', () => {
    const html = render(
      { parentId: 'c0000000-0000-4000-8000-00000000ffff' },
      {
        role: 'agent',
        userId: AUTHOR_ID,
      }
    )
    assert.deepEqual(actions(html), {
      reply: false,
      resolve: true,
      unresolve: false,
      edit: true,
      delete: true,
    })
  })

  it('actions are real buttons with visible text and an aria-label that contains it', () => {
    const html = render({}, { role: 'agent', userId: AUTHOR_ID })
    for (const [text, label] of [
      ['Reply', 'Reply to Alex Author'],
      ['Resolve', 'Resolve comment by Alex Author'],
      ['Edit', 'Edit comment by Alex Author'],
      ['Delete', 'Delete comment by Alex Author'],
    ]) {
      assert.match(
        html,
        new RegExp(`<button type="button"[^>]*aria-label="${label}"[^>]*>${text}</button>`)
      )
    }
    assert.match(html, /role="group" aria-label="Comment actions"/)
  })

  it('falls back to "Unknown" in labels when the author has no name', () => {
    const html = render({ authorName: null }, { role: 'agent', userId: OTHER_ID })
    assert.match(html, /aria-label="Reply to Unknown"/)
  })

  it('a resolved comment shows a visible "Resolved" badge and offers Unresolve', () => {
    const html = render({ resolved: true }, { role: 'agent', userId: OTHER_ID })
    assert.match(html, />Resolved</)
    assert.deepEqual(actions(html), {
      reply: true,
      resolve: false,
      unresolve: true,
      edit: false,
      delete: true,
    })
    assert.match(html, />Unresolve</)
  })

  it('an unresolved comment has no "Resolved" badge', () => {
    assert.doesNotMatch(render({}, { role: 'agent', userId: OTHER_ID }), />Resolved</)
  })

  it('resolved state stays visible to viewers who cannot resolve', () => {
    const html = render({ resolved: true }, { role: 'talent', userId: OTHER_ID })
    assert.match(html, />Resolved</)
    assert.doesNotMatch(html, /Unresolve/)
  })

  it('the confirm and edit UIs are closed on first render', () => {
    const html = render({}, { role: 'owner', userId: AUTHOR_ID })
    assert.doesNotMatch(html, /Confirm delete|<textarea/)
  })

  it('a deleted comment renders only the "Comment deleted" placeholder, with no actions', () => {
    const html = render(
      { deletedAt: '2026-10-23T11:00:00.000Z', content: 'secret words' },
      { role: 'owner', userId: AUTHOR_ID }
    )
    assert.match(html, />Comment deleted</)
    assert.doesNotMatch(html, /secret words|Comment actions|<button/)
  })
})

describe('CommentItem — action wiring (source invariants)', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(currentDir, 'CommentItem.tsx'), 'utf8')
  })

  it('asks for confirmation before deleting, with Cancel focused first', () => {
    assert.match(source, /setMode\('confirmDelete'\)/)
    assert.match(source, /Delete this comment\?/)
    assert.match(source, /cancelDeleteRef\.current\?\.focus\(\)/)
    // The only call into onDelete is the confirm button's handler.
    assert.equal([...source.matchAll(/run\(onDelete\)/g)].length, 1)
  })

  it('shows a failed action inline as an alert', () => {
    assert.match(source, /role="alert"/)
    assert.match(source, /setError\(err instanceof Error \? err\.message/)
  })

  it('edit saves on Enter, newline on Shift+Enter, cancels on Escape', () => {
    assert.match(source, /e\.key === 'Enter' && !e\.shiftKey/)
    assert.match(source, /e\.key === 'Escape'/)
  })

  it('edits are sent trimmed', () => {
    assert.match(source, /onEdit\(draft\.trim\(\)\)/)
  })

  it('gates every button on getCommentPermissions, not on role strings', () => {
    assert.match(
      source,
      /getCommentPermissions\(comment, \{ role: viewerRole, userId: viewerUserId \}\)/
    )
    assert.doesNotMatch(source, /viewerRole ===|role === '/)
  })
})
