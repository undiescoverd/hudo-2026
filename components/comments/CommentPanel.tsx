// components/comments/CommentPanel.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Comment } from '@/lib/comments'
import { useVideoPlayerContext } from '@/components/player/VideoPlayer'
import { useRealtimeComments } from '@/hooks/useRealtimeComments'
import { CommentThread } from './CommentThread'
import { CommentInput } from './CommentInput'

interface CommentPanelProps {
  videoId: string
  versionId: string
  agencyId: string
  userId: string
}

export function CommentPanel({ videoId, versionId, agencyId, userId }: CommentPanelProps) {
  const player = useVideoPlayerContext()
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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
      // Avoid duplicates
      if (prev.some((c) => c.id === comment.id)) return prev
      return [...prev, comment]
    })
  }, [])

  const handleUpdate = useCallback((updated: Comment) => {
    setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
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
    videoVersionId: versionId,
    onInsert: handleInsert,
    onUpdate: handleUpdate,
    onDelete: handleDelete,
  })

  const handleSeek = useCallback(
    (t: number) => {
      player.seek(t)
    },
    [player]
  )

  // Separate top-level and replies
  const topLevel = comments
    .filter((c) => c.parentId === null)
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds)

  const repliesByParent = comments.reduce<Record<string, Comment[]>>((acc, c) => {
    if (c.parentId !== null) {
      const existing = acc[c.parentId] ?? []
      acc[c.parentId] = [...existing, c].sort((a, b) => a.timestampSeconds - b.timestampSeconds)
    }
    return acc
  }, {})

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          </div>
        )}

        {!loading && error && (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && topLevel.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">No comments yet.</p>
          </div>
        )}

        {!loading &&
          !error &&
          topLevel.length > 0 &&
          topLevel.map((comment) => (
            <div key={comment.id} className="py-1">
              <CommentThread
                parent={comment}
                replies={repliesByParent[comment.id] ?? []}
                onSeek={handleSeek}
              />
            </div>
          ))}
      </div>
      <CommentInput
        videoId={videoId}
        versionId={versionId}
        agencyId={agencyId}
        userId={userId}
        onOptimisticInsert={handleInsert}
        onOptimisticRollback={handleOptimisticRollback}
      />
    </div>
  )
}
