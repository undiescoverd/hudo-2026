'use client'

import type { Comment } from '@/lib/comments'

function userColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h = Math.abs(hash) % 360
  return `hsl(${h}, 60%, 45%)`
}

interface TimelineBadgeProps {
  comment: Comment
  duration: number
  onSeek: (t: number) => void
  onHighlight?: (commentId: string) => void
}

export function TimelineBadge({ comment, duration, onSeek, onHighlight }: TimelineBadgeProps) {
  const color = userColor(comment.userId)
  const leftPct = (comment.timestampSeconds / duration) * 100

  const handleClick = () => {
    onSeek(comment.timestampSeconds)
    onHighlight?.(comment.id)
  }

  const tooltip = comment.content.slice(0, 50)
  const resolvedClass = comment.resolved ? 'opacity-50' : ''

  if (
    comment.commentType === 'range' &&
    comment.endTimestampSeconds !== null &&
    comment.endTimestampSeconds > comment.timestampSeconds
  ) {
    const rightPct = (comment.endTimestampSeconds / duration) * 100
    const widthPct = rightPct - leftPct

    return (
      <button
        type="button"
        title={tooltip}
        onClick={handleClick}
        className={`absolute top-0 h-full cursor-pointer rounded-sm transition-opacity hover:opacity-80 ${resolvedClass}`}
        style={{
          left: `${leftPct}%`,
          width: `${widthPct}%`,
          backgroundColor: color,
        }}
      />
    )
  }

  // Point comment — render as a dot
  return (
    <button
      type="button"
      title={tooltip}
      onClick={handleClick}
      className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border border-white/50 transition-opacity hover:scale-125 ${resolvedClass}`}
      style={{
        left: `${leftPct}%`,
        backgroundColor: color,
      }}
    />
  )
}
