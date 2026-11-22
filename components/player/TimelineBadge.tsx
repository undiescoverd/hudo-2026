'use client'

import type { Comment } from '@/lib/comments'

interface TimelineBadgeProps {
  comment: Comment
  duration: number
  onSeek: (t: number) => void
  onHighlight?: (commentId: string) => void
}

export function TimelineBadge({ comment, duration, onSeek, onHighlight }: TimelineBadgeProps) {
  const leftPct = (comment.timestampSeconds / duration) * 100

  const handleClick = () => {
    onSeek(comment.timestampSeconds)
    onHighlight?.(comment.id)
  }

  const tooltip = comment.content.slice(0, 50)
  // Coral marks open comments; resolved ones fade to the neutral faint tone.
  const markerClass = comment.resolved ? 'bg-faint opacity-55' : 'bg-coral'

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
        className={`absolute top-0 h-full cursor-pointer rounded-sm transition-opacity hover:opacity-80 ${markerClass}`}
        style={{
          left: `${leftPct}%`,
          width: `${widthPct}%`,
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
      className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full ring-2 ring-surface transition-transform hover:scale-125 ${markerClass}`}
      style={{
        left: `${leftPct}%`,
      }}
    />
  )
}
