// components/comments/CommentPanel.tsx
'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import type { Comment } from '@/lib/comments'
import { useVideoPlayerContext } from '@/components/player/VideoPlayer'
import { CommentThread } from './CommentThread'
import { CommentInput } from './CommentInput'
import { buildThreads } from './comment-threads'
import { afterAction, handleCommentGone } from '@/hooks/useVideoComments'

interface CommentPanelProps {
  videoId: string
  versionId: string
  agencyId: string
  userId: string
  /** Current user's display name — forwarded to CommentInput so the author's
   *  own optimistic comment shows their name before the POST response lands. */
  currentUserName?: string | null
  /** The viewer's agency role. Gates which actions each comment offers (the API
   *  re-checks all of them); with no role the panel is read-only plus the input. */
  viewerRole?: string | null
  // Comments, loading/error state, and mutation handlers are owned by the
  // page-level useVideoComments hook so there is exactly ONE fetch of the
  // comments endpoint — VideoPlayer's CommentTimeline shares the same state.
  comments: Comment[]
  loading: boolean
  error: string | null
  onOptimisticInsert: (comment: Comment) => void
  onOptimisticRollback: (tempId: string) => void
  /** Comment actions from useVideoComments. Each rejects with a user-facing
   *  message after rolling the list back; CommentItem shows it inline. A comment
   *  that turns out to be already deleted is handled here instead, as a notice. */
  onResolveComment?: (commentId: string, resolved: boolean) => Promise<void>
  onEditComment?: (commentId: string, content: string) => Promise<void>
  onDeleteComment?: (commentId: string) => Promise<void>
}

export function CommentPanel({
  videoId,
  versionId,
  agencyId,
  userId,
  currentUserName,
  viewerRole,
  comments,
  loading,
  error,
  onOptimisticInsert,
  onOptimisticRollback,
  onResolveComment,
  onEditComment,
  onDeleteComment,
}: CommentPanelProps) {
  const player = useVideoPlayerContext()

  const handleSeek = useCallback(
    (t: number) => {
      player.seek(t)
    },
    [player]
  )

  // Only the threads that actually render (live comments, or deleted parents that
  // still have replies), so the empty state follows what is on screen: a soft-deleted
  // comment stays in state, flagged by Realtime, and `comments.length` would lie.
  // Memoised because the panel re-renders on every player time update.
  const threads = useMemo(() => buildThreads(comments), [comments])

  // A comment already deleted elsewhere: the list heals itself (see the hook); say so.
  const [notice, setNotice] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const handlers = useMemo(
    () => ({
      resolve: handleCommentGone(onResolveComment, setNotice),
      edit: handleCommentGone(onEditComment, setNotice),
      // After a delete (or finding it already gone) the focused Delete button disappears;
      // park focus on the list instead of letting it drop to <body>. A failed delete
      // rethrows first, leaving focus on the comment that shows the error.
      remove: afterAction(handleCommentGone(onDeleteComment, setNotice), () =>
        listRef.current?.focus()
      ),
    }),
    [onResolveComment, onEditComment, onDeleteComment]
  )

  // Includes replies — matches what's actually rendered below (top-level + threads).
  const visibleCount = comments.filter((c) => c.deletedAt === null).length

  const replyInput = {
    videoId,
    versionId,
    agencyId,
    userId,
    currentUserName,
    onOptimisticInsert,
    onOptimisticRollback,
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className="border-b border-gray-100 px-4 py-3 dark:border-gray-800"
        title="Comments on this version"
      >
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Comments · {visibleCount}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">This version only</p>
      </div>
      <div role="status">
        {notice && (
          <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss notice"
              className="rounded px-1.5 py-0.5 font-medium hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-amber-900/40"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
      <div
        ref={listRef}
        tabIndex={-1}
        className="flex-1 overflow-y-auto divide-y divide-gray-100 focus:outline-none dark:divide-gray-800"
      >
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

        {!loading && !error && threads.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">No comments yet.</p>
          </div>
        )}

        {!loading &&
          !error &&
          threads.map(({ parent, replies }) => (
            <div key={parent.id} className="py-1">
              <CommentThread
                parent={parent}
                replies={replies}
                onSeek={handleSeek}
                viewerRole={viewerRole}
                viewerUserId={userId}
                onResolve={handlers.resolve}
                onEdit={handlers.edit}
                onDelete={handlers.remove}
                replyInput={replyInput}
              />
            </div>
          ))}
      </div>
      <CommentInput
        videoId={videoId}
        versionId={versionId}
        agencyId={agencyId}
        userId={userId}
        currentUserName={currentUserName}
        onOptimisticInsert={onOptimisticInsert}
        onOptimisticRollback={onOptimisticRollback}
      />
    </div>
  )
}
