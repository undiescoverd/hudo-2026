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
import type {
  CommentItem as CommentItemType,
  INITIAL_ITEM_STATE as Initial,
  itemReducer as ItemReducer,
} from './CommentItem'
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

describe('itemReducer — edit / delete-confirm / busy / error states', () => {
  let itemReducer: typeof ItemReducer
  let INITIAL_ITEM_STATE: typeof Initial

  before(async () => {
    ;(globalThis as { React?: unknown }).React = React
    ;({ itemReducer, INITIAL_ITEM_STATE } = await import('./CommentItem'))
  })

  it('starts viewing, idle, with no error', () => {
    assert.deepEqual(INITIAL_ITEM_STATE, { mode: 'view', busy: false, error: null })
  })

  it('open edit / open confirmDelete switch mode and clear an old error', () => {
    const failed = { mode: 'view' as const, busy: false, error: 'Access denied' }
    assert.deepEqual(itemReducer(failed, { type: 'open', mode: 'edit' }), {
      mode: 'edit',
      busy: false,
      error: null,
    })
    assert.deepEqual(itemReducer(failed, { type: 'open', mode: 'confirmDelete' }), {
      mode: 'confirmDelete',
      busy: false,
      error: null,
    })
  })

  it('close goes back to viewing and clears the error, without touching busy', () => {
    const editing = { mode: 'edit' as const, busy: false, error: 'boom' }
    assert.deepEqual(itemReducer(editing, { type: 'close' }), {
      mode: 'view',
      busy: false,
      error: null,
    })
  })

  it('start marks the item busy and clears the error, keeping the mode', () => {
    const editing = { mode: 'edit' as const, busy: false, error: 'boom' }
    assert.deepEqual(itemReducer(editing, { type: 'start' }), {
      mode: 'edit',
      busy: true,
      error: null,
    })
  })

  it('a saved edit goes back to viewing, idle', () => {
    const saving = { mode: 'edit' as const, busy: true, error: null }
    assert.deepEqual(itemReducer(saving, { type: 'succeeded' }), {
      mode: 'view',
      busy: false,
      error: null,
    })
  })

  it('a failed edit stays in the edit box with the message, so the draft can be retried', () => {
    const saving = { mode: 'edit' as const, busy: true, error: null }
    assert.deepEqual(
      itemReducer(saving, { type: 'failed', message: 'Too many requests.', mode: 'edit' }),
      { mode: 'edit', busy: false, error: 'Too many requests.' }
    )
  })

  it('a failed delete returns to viewing with the message', () => {
    const deleting = { mode: 'confirmDelete' as const, busy: true, error: null }
    assert.deepEqual(
      itemReducer(deleting, { type: 'failed', message: 'Access denied', mode: 'view' }),
      { mode: 'view', busy: false, error: 'Access denied' }
    )
  })

  it('a full cycle: confirm, start, fail, retry, succeed', () => {
    let state = INITIAL_ITEM_STATE
    state = itemReducer(state, { type: 'open', mode: 'confirmDelete' })
    state = itemReducer(state, { type: 'start' })
    assert.equal(state.busy, true)
    state = itemReducer(state, { type: 'failed', message: 'nope', mode: 'view' })
    assert.deepEqual(state, { mode: 'view', busy: false, error: 'nope' })
    state = itemReducer(state, { type: 'open', mode: 'confirmDelete' })
    assert.equal(state.error, null)
    state = itemReducer(state, { type: 'start' })
    state = itemReducer(state, { type: 'succeeded' })
    assert.deepEqual(state, INITIAL_ITEM_STATE)
  })
})
