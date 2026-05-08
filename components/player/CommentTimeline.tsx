'use client'

import type { Comment } from '@/lib/comments'
import { useVideoPlayerContext } from './VideoPlayer'
import { TimelineBadge } from './TimelineBadge'

interface CommentTimelineProps {
  comments: Comment[]
  onSeekToComment?: (commentId: string) => void
}

export function CommentTimeline({ comments, onSeekToComment }: CommentTimelineProps) {
  const { duration, seek } = useVideoPlayerContext()

  const visible = comments.filter((c) => c.deletedAt === null)

  if (duration === 0) {
    return <div className="h-2 w-full bg-gray-200 dark:bg-gray-700" />
  }

  // Group badges by rounded percentage position to handle overlap
  // For each bucket, show first 3 and a "+N more" badge for the rest
  const buckets = new Map<number, Comment[]>()
  for (const comment of visible) {
    const bucket = Math.round((comment.timestampSeconds / duration) * 100)
    const existing = buckets.get(bucket) ?? []
    buckets.set(bucket, [...existing, comment])
  }

  const rendered: React.ReactNode[] = []

  for (const [bucket, group] of buckets) {
    const shown = group.slice(0, 3)
    const overflow = group.length - shown.length

    for (const comment of shown) {
      rendered.push(
        <TimelineBadge
          key={comment.id}
          comment={comment}
          duration={duration}
          onSeek={seek}
          onHighlight={onSeekToComment}
        />
      )
    }

    if (overflow > 0) {
      const leftPct = bucket
      rendered.push(
        <span
          key={`overflow-${bucket}`}
          className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 select-none rounded bg-gray-800 px-0.5 text-[9px] leading-none text-white"
          style={{ left: `${leftPct}%` }}
          title={`${overflow} more comment${overflow === 1 ? '' : 's'}`}
        >
          +{overflow}
        </span>
      )
    }
  }

  return (
    <div className="relative h-2 w-full overflow-visible bg-gray-200 dark:bg-gray-700">
      {rendered}
    </div>
  )
}
