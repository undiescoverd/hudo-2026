'use client'

/**
 * GuestComments — read-only comment list for guest-link viewers.
 *
 * Displays author name, timestamp, and comment body. No input, no resolve,
 * no reply, no delete controls. No Supabase client imported or used.
 *
 * Uses a local GuestComment shape (subset of the API response) rather than
 * the full Comment type from lib/comments.ts, because guests receive a
 * stripped payload without userId, agencyId, etc.
 */

import type { GuestComment } from '@/lib/guest/get-guest-metadata'

interface GuestCommentsProps {
  comments: GuestComment[]
}

/** Format seconds as m:ss */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Format an ISO date string as a relative or absolute label */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function GuestCommentRow({ comment }: { comment: GuestComment }) {
  const author = comment.display_name ?? 'Anonymous'

  return (
    <div className="flex gap-3 rounded-lg p-3 hover:bg-gray-800/50">
      {/* Avatar */}
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-600 text-xs font-semibold text-white"
        aria-hidden="true"
      >
        {author.slice(0, 2).toUpperCase()}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-gray-300">{author}</span>

          {comment.timestamp_seconds != null && (
            <span className="rounded bg-gray-700 px-1.5 py-0.5 font-mono text-xs text-gray-300">
              {formatTime(comment.timestamp_seconds)}
            </span>
          )}

          <span className="ml-auto text-xs text-gray-500">{formatDate(comment.created_at)}</span>
        </div>

        <p className="mt-1 text-sm text-gray-200">{comment.content}</p>
      </div>
    </div>
  )
}

export function GuestComments({ comments }: GuestCommentsProps) {
  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
        Comments ({comments.length})
      </h2>

      {comments.length === 0 ? (
        <p className="text-sm text-gray-500">No comments yet.</p>
      ) : (
        <div className="space-y-1 overflow-y-auto">
          {comments.map((c) => (
            <GuestCommentRow key={c.id} comment={c} />
          ))}
        </div>
      )}
    </div>
  )
}
