// hooks/useVideoComments.ts
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Comment } from '@/lib/comments'
import { useRealtimeComments } from './useRealtimeComments'

interface UseVideoCommentsResult {
  comments: Comment[]
  loading: boolean
  error: string | null
  handleInsert: (comment: Comment) => void
  handleOptimisticRollback: (tempId: string) => void
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
    setComments((prev) => {
      // De-dupe by id: an optimistic/canonical insert and its Realtime echo can
      // arrive in EITHER order. The echo carries the raw comments row with no
      // `users` embed (authorName null); the REST/POST-sourced copy carries the
      // name. Merge on collision, preferring whichever copy has the author
      // fields, so a racing echo can't win and leave the author's own comment
      // showing "Unknown" until refresh.
      const existing = prev.find((c) => c.id === comment.id)
      if (existing) {
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
      return [...prev, comment]
    })
  }, [])

  const handleUpdate = useCallback((updated: Comment) => {
    // Realtime UPDATE payloads carry only the raw comments row — no `users`
    // embed — so `updated.authorName`/`authorAvatarUrl` are null. A resolve or
    // soft-delete broadcasts such an UPDATE to every subscriber; replacing the
    // whole object would flip an already-named comment to "Unknown" live until
    // the next GET. Preserve the existing author fields when the incoming
    // update lacks them.
    setComments((prev) =>
      prev.map((c) =>
        c.id === updated.id
          ? {
              ...updated,
              authorName: updated.authorName ?? c.authorName,
              authorAvatarUrl: updated.authorAvatarUrl ?? c.authorAvatarUrl,
            }
          : c
      )
    )
  }, [])

  const handleDelete = useCallback((commentId: string) => {
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, deletedAt: new Date().toISOString() } : c))
    )
  }, [])

  const handleOptimisticRollback = useCallback((tempId: string) => {
    setComments((prev) => prev.filter((c) => c.id !== tempId))
  }, [])

  useRealtimeComments({
    videoVersionId: versionId ?? '',
    onInsert: handleInsert,
    onUpdate: handleUpdate,
    onDelete: handleDelete,
  })

  return { comments, loading, error, handleInsert, handleOptimisticRollback }
}
