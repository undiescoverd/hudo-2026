/**
 * Which comment actions the UI offers each viewer. The API stays the source of
 * truth; this only decides which controls show.
 *
 * Run: npx tsx --test components/comments/comment-permissions.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { COMMENT_BODY_MAX_LENGTH } from '@/lib/comments'
import { getCommentPermissions, validateEditDraft } from './comment-permissions'
import { AUTHOR_ID, OTHER_ID, makeComment } from './comment-fixtures'

const ALL = { canReply: true, canResolve: true, canEdit: true, canDelete: true }
const NONE = { canReply: false, canResolve: false, canEdit: false, canDelete: false }

describe('getCommentPermissions — matrix on a top-level comment by AUTHOR_ID', () => {
  const comment = makeComment()

  it('talent who wrote it: reply, edit, delete; not resolve', () => {
    assert.deepEqual(getCommentPermissions(comment, { role: 'talent', userId: AUTHOR_ID }), {
      canReply: true,
      canResolve: false,
      canEdit: true,
      canDelete: true,
    })
  })

  it('talent who did not write it: reply only', () => {
    assert.deepEqual(getCommentPermissions(comment, { role: 'talent', userId: OTHER_ID }), {
      canReply: true,
      canResolve: false,
      canEdit: false,
      canDelete: false,
    })
  })

  it('agent who did not write it: reply, resolve, delete; not edit', () => {
    assert.deepEqual(getCommentPermissions(comment, { role: 'agent', userId: OTHER_ID }), {
      canReply: true,
      canResolve: true,
      canEdit: false,
      canDelete: true,
    })
  })

  it('admin_agent who did not write it: same as agent', () => {
    assert.deepEqual(getCommentPermissions(comment, { role: 'admin_agent', userId: OTHER_ID }), {
      canReply: true,
      canResolve: true,
      canEdit: false,
      canDelete: true,
    })
  })

  it('owner who did not write it: reply, resolve, delete; not edit', () => {
    assert.deepEqual(getCommentPermissions(comment, { role: 'owner', userId: OTHER_ID }), {
      canReply: true,
      canResolve: true,
      canEdit: false,
      canDelete: true,
    })
  })

  it('agent or owner who wrote it: everything', () => {
    assert.deepEqual(getCommentPermissions(comment, { role: 'agent', userId: AUTHOR_ID }), ALL)
    assert.deepEqual(getCommentPermissions(comment, { role: 'owner', userId: AUTHOR_ID }), ALL)
  })

  it('no role (guest, or role not loaded): nothing', () => {
    assert.deepEqual(getCommentPermissions(comment, {}), NONE)
    assert.deepEqual(getCommentPermissions(comment, { role: null, userId: AUTHOR_ID }), NONE)
    assert.deepEqual(getCommentPermissions(comment, { role: undefined, userId: AUTHOR_ID }), NONE)
    assert.deepEqual(getCommentPermissions(comment, { role: '', userId: AUTHOR_ID }), NONE)
  })

  it('no user id: nothing, even with a role', () => {
    assert.deepEqual(getCommentPermissions(comment, { role: 'owner' }), NONE)
    assert.deepEqual(getCommentPermissions(comment, { role: 'owner', userId: null }), NONE)
  })

  it('an unrecognised role is not a member: nothing (roleAtLeast would rank it above owner)', () => {
    assert.deepEqual(getCommentPermissions(comment, { role: 'guest', userId: AUTHOR_ID }), NONE)
    assert.deepEqual(getCommentPermissions(comment, { role: 'superuser', userId: AUTHOR_ID }), NONE)
  })
})

describe('getCommentPermissions — replies, deleted and unsaved comments', () => {
  it('Reply is offered on top-level comments only', () => {
    const reply = makeComment({ parentId: 'c0000000-0000-4000-8000-00000000ffff' })
    for (const role of ['talent', 'agent', 'admin_agent', 'owner']) {
      assert.equal(getCommentPermissions(makeComment(), { role, userId: OTHER_ID }).canReply, true)
      assert.equal(getCommentPermissions(reply, { role, userId: OTHER_ID }).canReply, false, role)
    }
  })

  it('a reply keeps the other actions: author edits/deletes it, agent resolves/deletes it', () => {
    const reply = makeComment({ parentId: 'c0000000-0000-4000-8000-00000000ffff' })
    assert.deepEqual(getCommentPermissions(reply, { role: 'talent', userId: AUTHOR_ID }), {
      canReply: false,
      canResolve: false,
      canEdit: true,
      canDelete: true,
    })
    assert.deepEqual(getCommentPermissions(reply, { role: 'agent', userId: OTHER_ID }), {
      canReply: false,
      canResolve: true,
      canEdit: false,
      canDelete: true,
    })
  })

  it('a deleted comment offers nothing, to anyone', () => {
    const deleted = makeComment({ deletedAt: '2026-10-23T11:00:00.000Z' })
    for (const role of ['talent', 'agent', 'admin_agent', 'owner']) {
      assert.deepEqual(getCommentPermissions(deleted, { role, userId: AUTHOR_ID }), NONE, role)
    }
  })

  it('an optimistic comment that has not been saved yet offers nothing (its id is not a UUID)', () => {
    const unsaved = makeComment({ id: 'temp-1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed' })
    assert.deepEqual(getCommentPermissions(unsaved, { role: 'owner', userId: AUTHOR_ID }), NONE)
  })

  it('a resolved comment still offers the same actions (Resolve becomes Unresolve in the UI)', () => {
    const resolved = makeComment({ resolved: true })
    assert.deepEqual(getCommentPermissions(resolved, { role: 'agent', userId: OTHER_ID }), {
      canReply: true,
      canResolve: true,
      canEdit: false,
      canDelete: true,
    })
  })
})

describe('validateEditDraft', () => {
  it('accepts a changed, non-empty draft within the limit', () => {
    assert.equal(validateEditDraft('Tighter pause please', 'Tighten the pause'), null)
  })

  it('rejects an empty or whitespace-only draft', () => {
    assert.ok(validateEditDraft('', 'x'))
    assert.ok(validateEditDraft('   \n', 'x'))
  })

  it('rejects a draft over the limit, accepts exactly the limit', () => {
    assert.ok(validateEditDraft('x'.repeat(COMMENT_BODY_MAX_LENGTH + 1), 'y'))
    assert.equal(validateEditDraft('x'.repeat(COMMENT_BODY_MAX_LENGTH), 'y'), null)
  })

  it('rejects an unchanged draft (surrounding whitespace ignored)', () => {
    assert.ok(validateEditDraft('  same  ', 'same'))
  })
})
