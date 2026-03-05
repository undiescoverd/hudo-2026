// components/comments/CommentItem.tsx
'use client'

import type { Comment } from '@/lib/comments'

interface CommentItemProps {
  comment: Comment
  onSeek: (t: number) => void
  isReply?: boolean
}

/** Generate a consistent HSL colour from a string (userId). */
function userColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h = Math.abs(hash) % 360
  return `hsl(${h}, 60%, 45%)`
}

/** Get initials from userId (first 2 chars, uppercase). */
function userInitials(userId: string): string {
  return userId.slice(0, 2).toUpperCase()
}

/** Format seconds as m:ss */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function CommentItem({ comment, onSeek, isReply = false }: CommentItemProps) {
  const isDeleted = comment.deletedAt !== null
  const isResolved = comment.resolved

  if (isDeleted) {
    return (
      <div className={`${isReply ? 'ml-8' : ''} py-2`}>
        <p className="text-xs italic text-gray-400 dark:text-gray-600">[comment deleted]</p>
      </div>
    )
  }

  return (
    <div
      className={[
        'group flex gap-3 rounded-lg p-3 transition-colors',
        isReply ? 'ml-8' : '',
        isResolved ? 'opacity-50' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Avatar */}
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
        style={{ backgroundColor: userColor(comment.userId) }}
        aria-hidden="true"
      >
        {userInitials(comment.userId)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Timestamp badge — click to seek */}
          <button
            type="button"
            onClick={() => onSeek(comment.timestampSeconds)}
            className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700 hover:bg-blue-100 hover:text-blue-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-blue-900/40 dark:hover:text-blue-400"
            aria-label={`Seek to ${formatTime(comment.timestampSeconds)}`}
          >
            {formatTime(comment.timestampSeconds)}
          </button>

          {isResolved && (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
              Resolved
            </span>
          )}
        </div>

        <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">{comment.content}</p>
      </div>
    </div>
  )
}
