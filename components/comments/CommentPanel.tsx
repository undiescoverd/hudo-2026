// components/comments/CommentPanel.tsx
'use client'

import { useCallback } from 'react'
import type { Comment } from '@/lib/comments'
import { useVideoPlayerContext } from '@/components/player/VideoPlayer'
import { CommentThread } from './CommentThread'
import { CommentInput } from './CommentInput'

interface CommentPanelProps {
  videoId: string
  versionId: string
  agencyId: string
  userId: string
  // Comments, loading/error state, and mutation handlers are owned by the
  // page-level useVideoComments hook so there is exactly ONE fetch of the
  // comments endpoint — VideoPlayer's CommentTimeline shares the same state.
  comments: Comment[]
  loading: boolean
  error: string | null
  onOptimisticInsert: (comment: Comment) => void
  onOptimisticRollback: (tempId: string) => void
}

export function CommentPanel({
  videoId,
  versionId,
  agencyId,
  userId,
  comments,
  loading,
  error,
  onOptimisticInsert,
  onOptimisticRollback,
}: CommentPanelProps) {
  const player = useVideoPlayerContext()

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
        onOptimisticInsert={onOptimisticInsert}
        onOptimisticRollback={onOptimisticRollback}
      />
    </div>
  )
}
