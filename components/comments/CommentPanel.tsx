// components/comments/CommentPanel.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Comment } from '@/lib/comments'
import { useVideoPlayerContext } from '@/components/player/VideoPlayer'
import { CommentThread } from './CommentThread'

interface CommentPanelProps {
  videoId: string
  versionId: string
}

export function CommentPanel({ videoId, versionId }: CommentPanelProps) {
  const player = useVideoPlayerContext()
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/videos/${videoId}/versions/${versionId}/comments`)
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
      acc[c.parentId] = [...(acc[c.parentId] ?? []), c]
    }
    return acc
  }, {})

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    )
  }

  if (topLevel.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">No comments yet.</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {topLevel.map((comment) => (
        <div key={comment.id} className="py-1">
          <CommentThread
            parent={comment}
            replies={repliesByParent[comment.id] ?? []}
            onSeek={handleSeek}
          />
        </div>
      ))}
    </div>
  )
}
