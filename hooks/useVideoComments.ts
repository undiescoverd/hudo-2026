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
  /** Resolve (true) or unresolve (false). Optimistic; rejects with a message after rolling back. */
  resolveComment: (commentId: string, resolved: boolean) => Promise<void>
  /** Edit the content. Optimistic; rejects with a message after rolling back. */
  editComment: (commentId: string, content: string) => Promise<void>
  /** Soft delete. Not optimistic: the list changes once the server confirms, and a
   *  failure rejects with a message and leaves the list untouched. */
  deleteComment: (commentId: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// State transitions. Pure, so the Realtime merge rules can be tested without a
// browser. The embed rule (CLAUDE.md Failure Log, Realtime, 2026-07-05): the
// comments GET/POST responses carry a `users` embed (authorName/authorAvatarUrl),
// but a Realtime payload is the raw row and does not. So an incoming copy must
// MERGE into the existing one, never replace it.
// ---------------------------------------------------------------------------

/**
 * Add a comment, de-duping by id. An optimistic/canonical insert and its Realtime
 * echo can arrive in EITHER order. The echo has no `users` embed (authorName
 * null); the REST/POST-sourced copy has the name. Merge on collision, preferring
 * whichever copy has the author fields, so a racing echo can't win and leave the
 * author's own comment showing "Unknown" until refresh.
 */
export function mergeInsert(prev: Comment[], comment: Comment): Comment[] {
  if (!prev.some((c) => c.id === comment.id)) return [...prev, comment]
  return prev.map((c) =>
    c.id === comment.id
      ? {
          ...c,
          ...comment,
          authorName: comment.authorName ?? c.authorName,
          authorAvatarUrl: comment.authorAvatarUrl ?? c.authorAvatarUrl,
        }
      : c
  )
}

/**
 * Apply an updated comment (a Realtime UPDATE, or a PATCH response). Such a copy
 * lacks the `users` embed, so replacing the whole object would flip an
 * already-named comment to "Unknown" until the next GET. Keep the existing author
 * fields when the incoming copy has none. Symmetric with {@link mergeInsert}.
 */
export function mergeUpdate(prev: Comment[], updated: Comment): Comment[] {
  return prev.map((c) =>
    c.id === updated.id
      ? {
          ...updated,
          authorName: updated.authorName ?? c.authorName,
          authorAvatarUrl: updated.authorAvatarUrl ?? c.authorAvatarUrl,
        }
      : c
  )
}

/** Set specific fields on one comment, leaving every other field (and comment) as is. */
export function patchCommentFields(
  prev: Comment[],
  commentId: string,
  fields: Partial<Comment>
): Comment[] {
  return prev.map((c) => (c.id === commentId ? { ...c, ...fields } : c))
}

// ---------------------------------------------------------------------------
// Requests to the existing comment endpoints (permissions and rate limits are
// enforced there; the UI only hides controls).
// ---------------------------------------------------------------------------

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  return body.error ?? `${fallback} (${res.status})`
}

/** PATCH /api/comments/:id with `{ content }` and/or `{ resolved }`. Resolves to the updated comment. */
export async function requestPatchComment(
  commentId: string,
  patch: { content: string } | { resolved: boolean }
): Promise<Comment> {
  const res = await fetch(`/api/comments/${encodeURIComponent(commentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to update comment'))
  const data = (await res.json().catch(() => null)) as { comment?: Record<string, unknown> } | null
  if (!data?.comment) throw new Error('Unexpected response from server')
  return rowToComment(data.comment)
}

/** DELETE /api/comments/:id (a soft delete on the server). */
export async function requestDeleteComment(commentId: string): Promise<void> {
  const res = await fetch(`/api/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to delete comment'))
}

/**
 * Optimistically patch one comment, then confirm with the server's copy. If the
 * request fails, restore only the fields that were patched (a Realtime update to
 * other fields meanwhile is kept) and rethrow so the caller can show the error.
 */
export async function runCommentMutation(opts: {
  apply: (update: (prev: Comment[]) => Comment[]) => void
  commentId: string
  previous: Comment
  optimistic: Partial<Comment>
  request: () => Promise<Comment>
}): Promise<void> {
  const { apply, commentId, previous, optimistic, request } = opts
  apply((prev) => patchCommentFields(prev, commentId, optimistic))
  try {
    const confirmed = await request()
    apply((prev) => mergeUpdate(prev, confirmed))
  } catch (err) {
    const restore: Record<string, unknown> = {}
    for (const key of Object.keys(optimistic)) restore[key] = previous[key as keyof Comment]
    apply((prev) => patchCommentFields(prev, commentId, restore as Partial<Comment>))
    throw err
  }
}

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
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Failed to load comments (${res.status})`)
        }
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
    setComments((prev) =>
      patchCommentFields(prev, commentId, { deletedAt: new Date().toISOString() })
    )
  }, [])

  const handleOptimisticRollback = useCallback((tempId: string) => {
    setComments((prev) => prev.filter((c) => c.id !== tempId))
  }, [])

  // The actions read the current comment (to roll back to) from a ref, so they stay
  // stable across renders and don't re-subscribe anything.
  const commentsRef = useRef(comments)
  commentsRef.current = comments

  const mutate = useCallback(
    (
      commentId: string,
      optimistic: Partial<Comment>,
      request: () => Promise<Comment>
    ): Promise<void> => {
      const previous = commentsRef.current.find((c) => c.id === commentId)
      if (!previous) return Promise.reject(new Error('Comment not found'))
      return runCommentMutation({ apply: setComments, commentId, previous, optimistic, request })
    },
    []
  )

  const resolveComment = useCallback(
    (commentId: string, resolved: boolean) =>
      mutate(
        commentId,
        resolved
          ? { resolved: true, resolvedAt: new Date().toISOString() }
          : { resolved: false, resolvedAt: null, resolvedBy: null },
        () => requestPatchComment(commentId, { resolved })
      ),
    [mutate]
  )

  const editComment = useCallback(
    (commentId: string, content: string) =>
      mutate(commentId, { content }, () => requestPatchComment(commentId, { content })),
    [mutate]
  )

  const deleteComment = useCallback(
    async (commentId: string) => {
      await requestDeleteComment(commentId)
      handleDelete(commentId)
    },
    [handleDelete]
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
