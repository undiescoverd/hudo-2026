/**
 * Tests for useVideoComments.
 *
 * The hook itself needs a browser (Realtime + React state), which the Node test
 * runner doesn't have, so its behaviour lives in exported pure functions and
 * request helpers that are tested directly; the hook is wired to them, which the
 * source invariants below pin down.
 *
 * Run: npx tsx --test "hooks/useVideoComments.test.ts"
 */

import assert from 'node:assert/strict'
import { afterEach, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import type { Comment } from '@/lib/comments'
import { makeComment } from '../components/comments/comment-fixtures'
import {
  COMMENT_GONE_MESSAGE,
  CommentGoneError,
  handleCommentGone,
  markDeleted,
  mergeInsert,
  mergeUpdate,
  patchCommentFields,
  requestDeleteComment,
  requestPatchComment,
  runCommentDelete,
  runCommentMutation,
} from './useVideoComments'

// ---------------------------------------------------------------------------
// Realtime merge rules (Failure Log, Realtime, 2026-07-05)
// ---------------------------------------------------------------------------

describe('mergeUpdate — merge, never replace (a Realtime UPDATE has no users embed)', () => {
  const named = makeComment({ authorName: 'Alex Author', authorAvatarUrl: 'https://img/alex.png' })
  // What rowToComment gives for a raw Realtime row: author fields null.
  const echo = (over: Partial<Comment>): Comment => ({
    ...named,
    authorName: null,
    authorAvatarUrl: null,
    ...over,
  })

  it('keeps authorName and authorAvatarUrl when the update lacks them (resolve)', () => {
    const [result] = mergeUpdate(
      [named],
      echo({ resolved: true, resolvedAt: '2026-10-23T12:00:00Z' })
    )
    assert.equal(result.resolved, true)
    assert.equal(result.authorName, 'Alex Author')
    assert.equal(result.authorAvatarUrl, 'https://img/alex.png')
  })

  it('keeps the author fields on a soft-delete UPDATE too', () => {
    const [result] = mergeUpdate([named], echo({ deletedAt: '2026-10-23T12:00:00Z' }))
    assert.equal(result.deletedAt, '2026-10-23T12:00:00Z')
    assert.equal(result.authorName, 'Alex Author')
  })

  it("applies the update's own fields (content edit, unresolve)", () => {
    const resolved = { ...named, resolved: true, resolvedAt: 't', resolvedBy: 'u' }
    const [result] = mergeUpdate(
      [resolved],
      echo({ content: 'edited', resolved: false, resolvedAt: null, resolvedBy: null })
    )
    assert.equal(result.content, 'edited')
    assert.equal(result.resolved, false)
    assert.equal(result.resolvedAt, null)
    assert.equal(result.resolvedBy, null)
  })

  it('takes the incoming author fields when the update has them', () => {
    const [result] = mergeUpdate([named], {
      ...named,
      authorName: 'Renamed',
      authorAvatarUrl: null,
    })
    assert.equal(result.authorName, 'Renamed')
    // no new avatar in the update -> the existing one is kept
    assert.equal(result.authorAvatarUrl, 'https://img/alex.png')
  })

  it('only touches the matching comment, and does not mutate its input', () => {
    const other = makeComment({ authorName: 'Other Person' })
    const prev = [named, other]
    const result = mergeUpdate(prev, echo({ resolved: true }))
    assert.equal(result[1], other)
    assert.equal(prev[0].resolved, false)
    assert.notEqual(result, prev)
  })

  it('ignores an update for an unknown comment', () => {
    const other = makeComment()
    assert.deepEqual(mergeUpdate([named], { ...other }), [named])
  })

  it('a delete never reverses: a stale UPDATE cannot bring a deleted comment back', () => {
    const deleted = { ...named, deletedAt: '2026-10-23T12:00:00Z' }
    // e.g. a resolve that raced the delete arrives afterwards, still saying deletedAt: null
    const [result] = mergeUpdate([deleted], echo({ resolved: true, deletedAt: null }))
    assert.equal(result.deletedAt, '2026-10-23T12:00:00Z')
    assert.equal(result.resolved, true) // its other fields still apply
  })

  it('keeps the first deletion time when a second delete update arrives', () => {
    const deleted = { ...named, deletedAt: '2026-10-23T12:00:00Z' }
    const [result] = mergeUpdate([deleted], echo({ deletedAt: '2026-10-23T13:00:00Z' }))
    assert.equal(result.deletedAt, '2026-10-23T12:00:00Z')
  })
})

describe('mergeInsert — symmetric with mergeUpdate', () => {
  const canonical = makeComment({ authorName: 'Alex Author', authorAvatarUrl: 'https://img/a.png' })
  const rawEcho: Comment = { ...canonical, authorName: null, authorAvatarUrl: null }

  it('appends a comment it has not seen', () => {
    const other = makeComment()
    assert.deepEqual(mergeInsert([other], canonical), [other, canonical])
  })

  it('canonical first, then the Realtime echo: the name survives', () => {
    const result = mergeInsert([canonical], rawEcho)
    assert.equal(result.length, 1)
    assert.equal(result[0].authorName, 'Alex Author')
    assert.equal(result[0].authorAvatarUrl, 'https://img/a.png')
  })

  it('echo first, then the canonical copy: the name arrives, still one row', () => {
    const result = mergeInsert([rawEcho], canonical)
    assert.equal(result.length, 1)
    assert.equal(result[0].authorName, 'Alex Author')
  })

  it('an insert echo arriving after a delete does not resurrect the comment', () => {
    const deleted = { ...canonical, deletedAt: '2026-10-23T12:00:00Z' }
    const result = mergeInsert([deleted], rawEcho)
    assert.equal(result.length, 1)
    assert.equal(result[0].deletedAt, '2026-10-23T12:00:00Z')
  })

  it('a reply insert (parentId set) dedupes the same way', () => {
    const reply = makeComment({ parentId: canonical.id, authorName: 'Rae Reply' })
    const result = mergeInsert(mergeInsert([canonical], reply), { ...reply, authorName: null })
    assert.equal(result.length, 2)
    assert.equal(result[1].authorName, 'Rae Reply')
    assert.equal(result[1].parentId, canonical.id)
  })
})

describe('patchCommentFields', () => {
  it('sets only the given fields on the matching comment', () => {
    const a = makeComment({ authorName: 'A' })
    const b = makeComment({ authorName: 'B' })
    const result = patchCommentFields([a, b], a.id, { content: 'new' })
    assert.equal(result[0].content, 'new')
    assert.equal(result[0].authorName, 'A')
    assert.equal(result[0].resolved, false)
    assert.equal(result[1], b)
  })
})

describe('markDeleted', () => {
  it('sets deletedAt on the matching comment only', () => {
    const a = makeComment()
    const b = makeComment()
    const result = markDeleted([a, b], a.id, '2026-10-23T12:00:00Z')
    assert.equal(result[0].deletedAt, '2026-10-23T12:00:00Z')
    assert.equal(result[1], b)
  })

  it('keeps an existing deletedAt', () => {
    const a = makeComment({ deletedAt: '2026-10-23T11:00:00Z' })
    assert.equal(
      markDeleted([a], a.id, '2026-10-23T12:00:00Z')[0].deletedAt,
      '2026-10-23T11:00:00Z'
    )
  })

  it('defaults to now', () => {
    const a = makeComment()
    assert.notEqual(markDeleted([a], a.id)[0].deletedAt, null)
  })
})

// ---------------------------------------------------------------------------
// Requests to the existing PATCH / DELETE /api/comments/:id endpoints
// ---------------------------------------------------------------------------

describe('comment requests', () => {
  const realFetch = globalThis.fetch
  const ID = 'c0000000-0000-4000-8000-000000000abc'
  let seen: { url: string; init: RequestInit }[] = []

  function stubFetch(respond: () => Response) {
    seen = []
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      seen.push({ url: String(input), init })
      return respond()
    }) as typeof fetch
  }

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  // The route returns the raw snake_case row, with no users embed.
  const row = {
    id: ID,
    video_version_id: 'v',
    agency_id: 'a',
    user_id: 'u',
    content: 'edited text',
    comment_type: 'point',
    timestamp_seconds: 4,
    end_timestamp_seconds: null,
    parent_id: null,
    resolved: true,
    resolved_at: '2026-10-23T12:00:00+00:00',
    resolved_by: 'agent-1',
    deleted_at: null,
    created_at: '2026-10-23T10:00:00+00:00',
  }

  it('resolve: PATCH /api/comments/:id with { resolved }, returns the camelCase comment', async () => {
    stubFetch(() => Response.json({ comment: row }))
    const comment = await requestPatchComment(ID, { resolved: true })
    assert.equal(seen.length, 1)
    assert.equal(seen[0].url, `/api/comments/${ID}`)
    assert.equal(seen[0].init.method, 'PATCH')
    assert.deepEqual(JSON.parse(seen[0].init.body as string), { resolved: true })
    assert.equal(new Headers(seen[0].init.headers).get('content-type'), 'application/json')
    assert.equal(comment.resolved, true)
    assert.equal(comment.resolvedBy, 'agent-1')
    assert.equal(comment.videoVersionId, 'v')
    assert.equal(comment.authorName, null) // no embed on this response
  })

  it('unresolve sends { resolved: false }', async () => {
    stubFetch(() => Response.json({ comment: { ...row, resolved: false } }))
    await requestPatchComment(ID, { resolved: false })
    assert.deepEqual(JSON.parse(seen[0].init.body as string), { resolved: false })
  })

  it('edit: PATCH with { content } only', async () => {
    stubFetch(() => Response.json({ comment: row }))
    await requestPatchComment(ID, { content: 'edited text' })
    assert.deepEqual(JSON.parse(seen[0].init.body as string), { content: 'edited text' })
  })

  it('delete: DELETE /api/comments/:id with no body', async () => {
    stubFetch(() => Response.json({ success: true }))
    await requestDeleteComment(ID)
    assert.equal(seen[0].url, `/api/comments/${ID}`)
    assert.equal(seen[0].init.method, 'DELETE')
    assert.equal(seen[0].init.body, undefined)
  })

  it("surfaces the API's own error message (403, 429, 500)", async () => {
    for (const [status, error] of [
      [403, 'Access denied'],
      [429, 'Too many requests. Please try again later.'],
      [500, 'Failed to update comment'],
    ] as const) {
      stubFetch(() => Response.json({ error }, { status }))
      await assert.rejects(requestPatchComment(ID, { resolved: true }), { message: error })
      await assert.rejects(requestDeleteComment(ID), { message: error })
    }
  })

  it('a 404 is a CommentGoneError (already deleted), for PATCH and DELETE', async () => {
    stubFetch(() => Response.json({ error: 'Comment not found' }, { status: 404 }))
    await assert.rejects(requestPatchComment(ID, { resolved: true }), CommentGoneError)
    await assert.rejects(requestDeleteComment(ID), CommentGoneError)
    await assert.rejects(requestDeleteComment(ID), { message: COMMENT_GONE_MESSAGE })
  })

  it('falls back to the status when the error body is not JSON', async () => {
    stubFetch(() => new Response('<html>bad gateway</html>', { status: 502 }))
    await assert.rejects(requestPatchComment(ID, { resolved: true }), {
      message: 'Failed to update comment (502)',
    })
    await assert.rejects(requestDeleteComment(ID), { message: 'Failed to delete comment (502)' })
  })

  it('rejects a 200 without a comment in it', async () => {
    stubFetch(() => Response.json({}))
    await assert.rejects(requestPatchComment(ID, { resolved: true }), {
      message: 'Unexpected response from server',
    })
  })
})

// ---------------------------------------------------------------------------
// Optimistic update + rollback
// ---------------------------------------------------------------------------

/** A tiny stand-in for the hook's setComments. */
function store(initial: Comment[]) {
  let state = initial
  return {
    get: () => state,
    apply: (update: (prev: Comment[]) => Comment[]) => {
      state = update(state)
    },
  }
}

const RESOLVE = ['resolved', 'resolvedAt', 'resolvedBy'] as const
const EDIT = ['content'] as const

/** What a raw Realtime row looks like after rowToComment: no users embed. */
const raw = (c: Comment, over: Partial<Comment>): Comment => ({
  ...c,
  authorName: null,
  authorAvatarUrl: null,
  ...over,
})

describe('runCommentMutation', () => {
  const base = makeComment({ authorName: 'Alex Author', authorAvatarUrl: 'https://img/a.png' })
  const other = makeComment({ authorName: 'Other Person' })

  it('applies the change before the request settles', async () => {
    const s = store([base, other])
    let seenDuring: Comment | undefined
    await runCommentMutation({
      apply: s.apply,
      commentId: base.id,
      previous: base,
      owned: RESOLVE,
      optimistic: { resolved: true },
      request: async () => {
        seenDuring = s.get().find((c) => c.id === base.id)
        return raw(base, { resolved: true, resolvedAt: 't1', resolvedBy: 'agent-1' })
      },
    })
    assert.equal(seenDuring?.resolved, true)
  })

  it('on success takes only the owned fields from the response and keeps the author fields', async () => {
    const s = store([base, other])
    await runCommentMutation({
      apply: s.apply,
      commentId: base.id,
      previous: base,
      owned: RESOLVE,
      optimistic: { resolved: true },
      request: async () => raw(base, { resolved: true, resolvedAt: 't1', resolvedBy: 'agent-1' }),
    })
    const [result, untouched] = s.get()
    assert.equal(result.resolved, true)
    assert.equal(result.resolvedAt, 't1')
    assert.equal(result.resolvedBy, 'agent-1')
    assert.equal(result.authorName, 'Alex Author')
    assert.equal(result.authorAvatarUrl, 'https://img/a.png')
    assert.equal(untouched, other)
  })

  it('on failure restores every owned field and rethrows the error', async () => {
    const resolved = { ...base, resolved: true, resolvedAt: 't0', resolvedBy: 'agent-0' }
    const s = store([resolved, other])
    await assert.rejects(
      runCommentMutation({
        apply: s.apply,
        commentId: resolved.id,
        previous: resolved,
        owned: RESOLVE,
        optimistic: { resolved: false }, // unresolve
        request: async () => {
          assert.equal(s.get()[0].resolved, false) // optimistic state is visible meanwhile
          throw new Error('Access denied')
        },
      }),
      { message: 'Access denied' }
    )
    assert.deepEqual(s.get(), [resolved, other])
  })

  it('a failed edit restores the old content', async () => {
    const s = store([base])
    await assert.rejects(
      runCommentMutation({
        apply: s.apply,
        commentId: base.id,
        previous: base,
        owned: EDIT,
        optimistic: { content: 'my new text' },
        request: async () => {
          throw new Error('Too many requests. Please try again later.')
        },
      }),
      { message: 'Too many requests. Please try again later.' }
    )
    assert.equal(s.get()[0].content, base.content)
  })

  it('(a) A resolves, B resolves first via Realtime, A fails: B wins, no mixed state', async () => {
    const s = store([base])
    await assert.rejects(
      runCommentMutation({
        apply: s.apply,
        commentId: base.id,
        previous: base,
        owned: RESOLVE,
        optimistic: { resolved: true },
        request: async () => {
          // B's resolve is broadcast while A's request is in flight...
          s.apply((prev) =>
            mergeUpdate(prev, raw(base, { resolved: true, resolvedAt: 'tB', resolvedBy: 'B' }))
          )
          // ...and then A's request fails (say, rate limited).
          throw new Error('Too many requests. Please try again later.')
        },
      })
    )
    const [result] = s.get()
    assert.equal(result.resolved, true)
    assert.equal(result.resolvedBy, 'B')
    assert.equal(result.resolvedAt, 'tB')
    assert.equal(result.authorName, 'Alex Author')
  })

  it('(a, unresolve) A unresolves, B unresolves first, A fails: stays unresolved', async () => {
    const resolved = { ...base, resolved: true, resolvedAt: 't0', resolvedBy: 'agent-0' }
    const s = store([resolved])
    await assert.rejects(
      runCommentMutation({
        apply: s.apply,
        commentId: resolved.id,
        previous: resolved,
        owned: RESOLVE,
        optimistic: { resolved: false },
        request: async () => {
          s.apply((prev) =>
            mergeUpdate(prev, raw(base, { resolved: false, resolvedAt: null, resolvedBy: null }))
          )
          throw new Error('boom')
        },
      })
    )
    const [result] = s.get()
    assert.equal(result.resolved, false)
    assert.equal(result.resolvedBy, null)
  })

  it('(b) A edits, B resolves via Realtime before A responds: the confirm does not reset resolved', async () => {
    const s = store([base])
    await runCommentMutation({
      apply: s.apply,
      commentId: base.id,
      previous: base,
      owned: EDIT,
      optimistic: { content: 'edited' },
      request: async () => {
        s.apply((prev) =>
          mergeUpdate(prev, raw(base, { resolved: true, resolvedAt: 'tB', resolvedBy: 'B' }))
        )
        // The PATCH response was read before B's write landed, so it still says unresolved.
        return raw(base, { content: 'edited', resolved: false, resolvedAt: null, resolvedBy: null })
      },
    })
    const [result] = s.get()
    assert.equal(result.content, 'edited')
    assert.equal(result.resolved, true)
    assert.equal(result.resolvedBy, 'B')
  })

  it('a failed edit does not undo a resolve that arrived meanwhile', async () => {
    const s = store([base])
    await assert.rejects(
      runCommentMutation({
        apply: s.apply,
        commentId: base.id,
        previous: base,
        owned: EDIT,
        optimistic: { content: 'edited' },
        request: async () => {
          s.apply((prev) => mergeUpdate(prev, raw(base, { resolved: true, resolvedBy: 'B' })))
          throw new Error('boom')
        },
      })
    )
    const [result] = s.get()
    assert.equal(result.content, base.content) // rolled back
    assert.equal(result.resolved, true) // kept
  })

  it("a failed edit keeps someone else's newer edit of the same comment", async () => {
    const s = store([base])
    await assert.rejects(
      runCommentMutation({
        apply: s.apply,
        commentId: base.id,
        previous: base,
        owned: EDIT,
        optimistic: { content: 'mine' },
        request: async () => {
          s.apply((prev) => mergeUpdate(prev, raw(base, { content: 'theirs' })))
          throw new Error('boom')
        },
      })
    )
    assert.equal(s.get()[0].content, 'theirs')
  })

  it('a 404 marks the comment deleted instead of rolling back, and rethrows', async () => {
    const s = store([base, other])
    await assert.rejects(
      runCommentMutation({
        apply: s.apply,
        commentId: base.id,
        previous: base,
        owned: EDIT,
        optimistic: { content: 'edited' },
        request: async () => {
          throw new CommentGoneError()
        },
      }),
      CommentGoneError
    )
    const [gone, untouched] = s.get()
    assert.notEqual(gone.deletedAt, null)
    assert.equal(untouched, other)
  })
})

describe('runCommentDelete', () => {
  const base = makeComment({ authorName: 'Alex Author' })
  const other = makeComment()

  it('sets deletedAt once the request resolves', async () => {
    const s = store([base, other])
    await runCommentDelete({ apply: s.apply, commentId: base.id, request: async () => {} })
    const [deleted, untouched] = s.get()
    assert.notEqual(deleted.deletedAt, null)
    assert.equal(deleted.authorName, 'Alex Author')
    assert.equal(untouched, other)
  })

  it('is not optimistic: the list is untouched while the request is in flight', async () => {
    const s = store([base])
    let during: string | null | undefined
    await runCommentDelete({
      apply: s.apply,
      commentId: base.id,
      request: async () => {
        during = s.get()[0].deletedAt
      },
    })
    assert.equal(during, null)
  })

  it('leaves the list untouched, and rethrows, when the request rejects', async () => {
    const s = store([base, other])
    await assert.rejects(
      runCommentDelete({
        apply: s.apply,
        commentId: base.id,
        request: async () => {
          throw new Error('Access denied')
        },
      }),
      { message: 'Access denied' }
    )
    assert.deepEqual(s.get(), [base, other])
  })

  it('a 404 (already deleted) heals the list locally and rethrows the CommentGoneError', async () => {
    const s = store([base])
    await assert.rejects(
      runCommentDelete({
        apply: s.apply,
        commentId: base.id,
        request: async () => {
          throw new CommentGoneError()
        },
      }),
      CommentGoneError
    )
    assert.notEqual(s.get()[0].deletedAt, null)
  })
})

describe('handleCommentGone', () => {
  it('turns a CommentGoneError into a notice and resolves', async () => {
    const notices: string[] = []
    const wrapped = handleCommentGone(
      async () => {
        throw new CommentGoneError()
      },
      (m) => notices.push(m)
    )
    await wrapped?.()
    assert.deepEqual(notices, [COMMENT_GONE_MESSAGE])
  })

  it('rethrows any other error and shows no notice', async () => {
    const notices: string[] = []
    const wrapped = handleCommentGone(
      async () => {
        throw new Error('Access denied')
      },
      (m) => notices.push(m)
    )
    await assert.rejects(wrapped!(), { message: 'Access denied' })
    assert.deepEqual(notices, [])
  })

  it('passes arguments through and resolves normally on success', async () => {
    const calls: unknown[][] = []
    const wrapped = handleCommentGone(
      async (...args: unknown[]) => {
        calls.push(args)
      },
      () => assert.fail('no notice expected')
    )
    await wrapped?.('id-1', true)
    assert.deepEqual(calls, [['id-1', true]])
  })

  it('no action in, none out (so no button is offered without a handler)', () => {
    assert.equal(
      handleCommentGone(undefined, () => {}),
      undefined
    )
  })
})

// ---------------------------------------------------------------------------
// Source invariants — the hook is wired to the pieces above
// ---------------------------------------------------------------------------

describe('useVideoComments — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(currentDir, 'useVideoComments.ts'), 'utf8')
  })

  it('is a client hook', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('exports a useVideoComments hook', () => {
    assert.match(source, /export function useVideoComments/)
  })

  it('fetches the comments endpoint exactly once', () => {
    const matches = [
      ...source.matchAll(
        /fetch\(\s*`\/api\/videos\/\$\{encodeURIComponent\(videoId\)\}\/versions\/\$\{encodeURIComponent\(versionId\)\}\/comments`/g
      ),
    ]
    assert.equal(matches.length, 1, 'must fetch the comments endpoint exactly once')
  })

  it('skips the fetch entirely when there is no active version', () => {
    assert.match(source, /if \(!versionId\) \{/)
  })

  it('subscribes to realtime comment changes scoped to the video version', () => {
    assert.match(source, /useRealtimeComments\(/)
    assert.match(source, /videoVersionId: versionId/)
  })

  it('routes Realtime inserts and updates through the merge functions (symmetric)', () => {
    assert.match(source, /setComments\(\(prev\) => mergeInsert\(prev, comment\)\)/)
    assert.match(source, /setComments\(\(prev\) => mergeUpdate\(prev, updated\)\)/)
    assert.match(source, /onInsert: handleInsert/)
    assert.match(source, /onUpdate: handleUpdate/)
  })

  it('exposes comments, loading, error, and the mutation handlers for callers to share', () => {
    const returned = source.slice(source.lastIndexOf('return {'))
    for (const name of [
      'comments',
      'loading',
      'error',
      'handleInsert',
      'handleOptimisticRollback',
      'resolveComment',
      'editComment',
      'deleteComment',
    ]) {
      assert.match(returned, new RegExp(`\\b${name},`), `must return ${name}`)
    }
  })

  it('resolve and edit go through PATCH and runCommentMutation with their owned fields', () => {
    assert.match(source, /requestPatchComment\(commentId, \{ resolved \}\)/)
    assert.match(source, /requestPatchComment\(commentId, \{ content \}\)/)
    assert.match(source, /RESOLVE_FIELDS = \['resolved', 'resolvedAt', 'resolvedBy'\]/)
    assert.match(source, /EDIT_FIELDS = \['content'\]/)
  })

  it('delete goes through DELETE and runCommentDelete, and never hard-deletes', () => {
    assert.match(source, /runCommentDelete\(\{/)
    assert.match(source, /requestDeleteComment\(commentId\)/)
    assert.doesNotMatch(source, /\.delete\(\)/)
  })
})
