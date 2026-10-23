// hooks/useVideoComments.ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { rowToComment, type Comment } from '@/lib/comments'
import { useRealtimeComments } from './useRealtimeComments'

interface UseVideoCommentsResult {
  comments: Comment[]
  loading: boolean
  error: string | null
  handleInsert: (comment: Comment) => void
  handleOptimisticRollback: (tempId: string) => void
  /** Resolve (true) or unresolve (false). Optimistic; rejects with a message after rolling back.
   *  A 404 (comment already deleted) rejects with a CommentGoneError after marking it deleted. */
  resolveComment: (commentId: string, resolved: boolean) => Promise<void>
  /** Edit the content. Optimistic; rejects like resolveComment. */
  editComment: (commentId: string, content: string) => Promise<void>
  /** Soft delete. Not optimistic: the list changes once the server confirms (a 404 counts,
   *  and rejects with a CommentGoneError); any other failure rejects and leaves the list untouched. */
  deleteComment: (commentId: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// State transitions. Pure, so the Realtime merge rules can be tested without a
// browser. The embed rule (CLAUDE.md Failure Log, Realtime, 2026-07-05): the
// comments GET/POST responses carry a `users` embed (authorName/authorAvatarUrl),
// but a Realtime payload is the raw row and does not. So an incoming copy must
// MERGE into the existing one, never replace it.
// ---------------------------------------------------------------------------

type Apply = (update: (prev: Comment[]) => Comment[]) => void

/**
 * Apply an updated copy of a comment (a Realtime UPDATE, a Realtime INSERT echo,
 * or a canonical POST response). Such a copy can lack the `users` embed, so
 * replacing the whole object would flip an already-named comment to "Unknown"
 * until the next GET; keep the existing author fields when the incoming copy has
 * none. A delete never reverses, so a stale copy (a resolve that raced the
 * delete, say) must not bring a deleted comment back.
 */
export function mergeUpdate(prev: Comment[], updated: Comment): Comment[] {
  return prev.map((c) =>
    c.id === updated.id
      ? {
          ...updated,
          authorName: updated.authorName ?? c.authorName,
          authorAvatarUrl: updated.authorAvatarUrl ?? c.authorAvatarUrl,
          deletedAt: c.deletedAt ?? updated.deletedAt,
        }
      : c
  )
}

/**
 * Add a comment, de-duping by id. An optimistic/canonical insert and its Realtime
 * echo can arrive in EITHER order, so on a collision merge exactly as an update
 * does: whichever copy has the author fields wins them, and arrival order stops
 * mattering (a racing echo can't leave the author's own comment as "Unknown").
 */
export function mergeInsert(prev: Comment[], comment: Comment): Comment[] {
  return prev.some((c) => c.id === comment.id) ? mergeUpdate(prev, comment) : [...prev, comment]
}

/** Set specific fields on one comment, leaving every other field (and comment) as is. */
export function patchCommentFields(
  prev: Comment[],
  commentId: string,
  fields: Partial<Comment>
): Comment[] {
  return prev.map((c) => (c.id === commentId ? { ...c, ...fields } : c))
}

/** Soft-delete one comment in state. An existing deletedAt is kept. */
export function markDeleted(
  prev: Comment[],
  commentId: string,
  at: string = new Date().toISOString()
): Comment[] {
  return prev.map((c) => (c.id === commentId ? { ...c, deletedAt: c.deletedAt ?? at } : c))
}

/** Copy the named fields from `source` onto `target`. */
function copyFields<K extends keyof Comment>(
  target: Comment,
  source: Comment,
  keys: readonly K[]
): Comment {
  const next = { ...target }
  for (const key of keys) next[key] = source[key]
  return next
}

// ---------------------------------------------------------------------------
// Requests to the existing comment endpoints (permissions and rate limits are
// enforced there; the UI only hides controls).
// ---------------------------------------------------------------------------

export const COMMENT_GONE_MESSAGE = 'This comment was already deleted.'

/** PATCH or DELETE answered 404: the comment is deleted (or gone) on the server. */
export class CommentGoneError extends Error {
  constructor() {
    super(COMMENT_GONE_MESSAGE)
    this.name = 'CommentGoneError'
  }
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  return body.error ?? `${fallback} (${res.status})`
}

/** PATCH /api/comments/:id with `{ content }` or `{ resolved }`. Resolves to the updated comment. */
export async function requestPatchComment(
  commentId: string,
  patch: { content: string } | { resolved: boolean }
): Promise<Comment> {
  const res = await fetch(`/api/comments/${encodeURIComponent(commentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (res.status === 404) throw new CommentGoneError()
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to update comment'))
  const data = (await res.json().catch(() => null)) as { comment?: Record<string, unknown> } | null
  if (!data?.comment) throw new Error('Unexpected response from server')
  return rowToComment(data.comment)
}

/** DELETE /api/comments/:id (a soft delete on the server). */
export async function requestDeleteComment(commentId: string): Promise<void> {
  const res = await fetch(`/api/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' })
  if (res.status === 404) throw new CommentGoneError()
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to delete comment'))
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Optimistically change one comment, then confirm with the server's copy.
 *
 * Each mutation OWNS a list of fields (resolve: resolved/resolvedAt/resolvedBy,
 * edit: content) and only ever writes those, so a Realtime update to anything
 * else is never clobbered:
 * - on success only the owned fields are taken from the response (an edit's
 *   response must not reset `resolved` that someone else changed meanwhile);
 * - on failure the owned fields go back to `previous`, but only if they still hold
 *   exactly what this mutation left there. If any owned field has since changed,
 *   another update has superseded this one as a whole and wins (restoring just
 *   some of the fields would leave a mixed state such as resolved:false, resolvedBy:B).
 *
 * A 404 means the comment is gone: it is marked deleted instead of rolled back.
 * Either way the error is rethrown for the caller to show.
 */
export async function runCommentMutation<K extends keyof Comment>(opts: {
  apply: Apply
  commentId: string
  previous: Comment
  owned: readonly K[]
  /** The owned fields to change straight away; owned fields not listed keep their value. */
  optimistic: Partial<Pick<Comment, K>>
  request: () => Promise<Comment>
}): Promise<void> {
  const { apply, commentId, previous, owned, optimistic, request } = opts
  const expected: Comment = { ...previous, ...optimistic }
  const mapOne = (change: (c: Comment) => Comment) => (prev: Comment[]) =>
    prev.map((c) => (c.id === commentId ? change(c) : c))

  apply((prev) => patchCommentFields(prev, commentId, optimistic))
  try {
    const confirmed = await request()
    apply(mapOne((c) => copyFields(c, confirmed, owned)))
  } catch (err) {
    if (err instanceof CommentGoneError) {
      apply((prev) => markDeleted(prev, commentId))
    } else {
      apply(
        mapOne((c) =>
          owned.every((k) => c[k] === expected[k]) ? copyFields(c, previous, owned) : c
        )
      )
    }
    throw err
  }
}

/**
 * Soft-delete a comment. Not optimistic: the list only changes once the server
 * confirms (or says the comment is already gone, which comes to the same thing),
 * so on any other failure the list is untouched and the error is rethrown.
 */
export async function runCommentDelete(opts: {
  apply: Apply
  commentId: string
  request: () => Promise<void>
}): Promise<void> {
  const { apply, commentId, request } = opts
  try {
    await request()
  } catch (err) {
    if (err instanceof CommentGoneError) apply((prev) => markDeleted(prev, commentId))
    throw err
  }
  apply((prev) => markDeleted(prev, commentId))
}

/**
 * Wrap a comment action so that "the comment is already gone" (after the list has
 * been healed) becomes a notice instead of an error: the comment disappearing is
 * the outcome. Anything else is rethrown. No action in, none out.
 */
export function handleCommentGone<A extends unknown[]>(
  action: ((...args: A) => Promise<void>) | undefined,
  onGone: (message: string) => void
): ((...args: A) => Promise<void>) | undefined {
  if (!action) return undefined
  return async (...args: A) => {
    try {
      await action(...args)
    } catch (err) {
      if (err instanceof CommentGoneError) {
        onGone(err.message)
        return
      }
      throw err
    }
  }
}

const RESOLVE_FIELDS = ['resolved', 'resolvedAt', 'resolvedBy'] as const
const EDIT_FIELDS = ['content'] as const

/**
 * Single source of truth for a video version's comments.
 *
 * Fetched exactly once here (per videoId/versionId) and shared by both
 * CommentPanel (thread + input) and VideoPlayer (CommentTimeline markers) —
 * this repo previously had CommentPanel self-fetch, which left VideoPlayer
 * with no comment data at all. Do not add a second fetch of this endpoint;
 * pass this hook's `comments` down instead.
 *
 * Realtime inserts/updates/deletes (scoped to video_version_id, per
 * CLAUDE.md) flow into the same state, so markers and the panel stay in
 * sync automatically — no separate wiring needed for either consumer.
 */
export function useVideoComments(
  videoId: string,
  versionId: string | null
): UseVideoCommentsResult {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!versionId) {
      setComments([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(
      `/api/videos/${encodeURIComponent(videoId)}/versions/${encodeURIComponent(versionId)}/comments`
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(await errorMessage(res, 'Failed to load comments'))
        return res.json() as Promise<{ comments: Comment[] }>
      })
      .then(({ comments: data }) => {
        if (!cancelled) {
          setComments(data)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load comments')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [videoId, versionId])

  const handleInsert = useCallback((comment: Comment) => {
    setComments((prev) => mergeInsert(prev, comment))
  }, [])

  const handleUpdate = useCallback((updated: Comment) => {
    setComments((prev) => mergeUpdate(prev, updated))
  }, [])

  const handleDelete = useCallback((commentId: string) => {
    setComments((prev) => markDeleted(prev, commentId))
  }, [])

  const handleOptimisticRollback = useCallback((tempId: string) => {
    setComments((prev) => prev.filter((c) => c.id !== tempId))
  }, [])

  // The actions read the current comment (to roll back to) from a ref, so they stay
  // stable across renders and don't re-subscribe anything.
  const commentsRef = useRef(comments)
  commentsRef.current = comments

  const mutate = useCallback(
    <K extends keyof Comment>(
      commentId: string,
      owned: readonly K[],
      optimistic: Partial<Pick<Comment, K>>,
      request: () => Promise<Comment>
    ): Promise<void> => {
      const previous = commentsRef.current.find((c) => c.id === commentId)
      if (!previous) return Promise.reject(new Error('Comment not found'))
      return runCommentMutation({
        apply: setComments,
        commentId,
        previous,
        owned,
        optimistic,
        request,
      })
    },
    []
  )

  const resolveComment = useCallback(
    (commentId: string, resolved: boolean) =>
      // Only `resolved` flips straight away; resolvedAt/resolvedBy come from the response.
      mutate(commentId, RESOLVE_FIELDS, { resolved }, () =>
        requestPatchComment(commentId, { resolved })
      ),
    [mutate]
  )

  const editComment = useCallback(
    (commentId: string, content: string) =>
      mutate(commentId, EDIT_FIELDS, { content }, () =>
        requestPatchComment(commentId, { content })
      ),
    [mutate]
  )

  const deleteComment = useCallback(
    (commentId: string) =>
      runCommentDelete({
        apply: setComments,
        commentId,
        request: () => requestDeleteComment(commentId),
      }),
    []
  )

  useRealtimeComments({
    videoVersionId: versionId ?? '',
    onInsert: handleInsert,
    onUpdate: handleUpdate,
    onDelete: handleDelete,
  })

  return {
    comments,
    loading,
    error,
    handleInsert,
    handleOptimisticRollback,
    resolveComment,
    editComment,
    deleteComment,
  }
}
