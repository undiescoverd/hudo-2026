// components/comments/CommentThread.tsx
'use client'

import type { Comment } from '@/lib/comments'
import { CommentItem } from './CommentItem'

interface CommentThreadProps {
  parent: Comment
  replies: Comment[]
  onSeek: (t: number) => void
}

export function CommentThread({ parent, replies, onSeek }: CommentThreadProps) {
  // Filter out deleted leaf replies
  const visibleReplies = replies.filter((r) => r.deletedAt === null)

  // If parent is deleted and has no visible replies, don't render at all
  if (parent.deletedAt !== null && visibleReplies.length === 0) {
    return null
  }

  return (
    <div className="space-y-0.5">
      <CommentItem comment={parent} onSeek={onSeek} />
      {visibleReplies.map((reply) => (
        <CommentItem key={reply.id} comment={reply} onSeek={onSeek} isReply />
      ))}
    </div>
  )
}
