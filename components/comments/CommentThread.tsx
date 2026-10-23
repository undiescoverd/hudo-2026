// components/comments/CommentThread.tsx
'use client'

import { useState } from 'react'
import type { Comment } from '@/lib/comments'
import { CommentItem } from './CommentItem'
import { CommentInput, type CommentInputProps } from './CommentInput'
import { isThreadVisible, visibleReplies } from './comment-threads'

interface CommentThreadProps {
  parent: Comment
  replies: Comment[]
  onSeek: (t: number) => void
  /** The viewer's agency role and user id; with no role no actions render. */
  viewerRole?: string | null
  viewerUserId?: string | null
  onResolve?: (commentId: string, resolved: boolean) => Promise<void>
  onEdit?: (commentId: string, content: string) => Promise<void>
  onDelete?: (commentId: string) => Promise<void>
  /** What the inline reply composer needs. Omit it and replying is not offered. */
  replyInput?: Omit<CommentInputProps, 'replyTo' | 'onCancel' | 'onPosted'>
}

export function CommentThread({
  parent,
  replies,
  onSeek,
  viewerRole,
  viewerUserId,
  onResolve,
  onEdit,
  onDelete,
  replyInput,
}: CommentThreadProps) {
  const [replying, setReplying] = useState(false)

  // Hide a deleted parent that has no live replies; with replies it stays as a
  // "Comment deleted" placeholder (CommentItem) and its replies remain.
  if (!isThreadVisible(parent, replies)) {
    return null
  }

  const actionsFor = (comment: Comment) => ({
    viewerRole,
    viewerUserId,
    onResolve: onResolve ? (resolved: boolean) => onResolve(comment.id, resolved) : undefined,
    onEdit: onEdit ? (content: string) => onEdit(comment.id, content) : undefined,
    onDelete: onDelete ? () => onDelete(comment.id) : undefined,
  })

  return (
    <div className="space-y-0.5">
      <CommentItem
        comment={parent}
        onSeek={onSeek}
        {...actionsFor(parent)}
        onReply={replyInput ? () => setReplying(true) : undefined}
      />
      {visibleReplies(replies).map((reply) => (
        <CommentItem
          key={reply.id}
          comment={reply}
          onSeek={onSeek}
          isReply
          {...actionsFor(reply)}
        />
      ))}
      {replying && replyInput && parent.deletedAt === null && (
        <CommentInput
          {...replyInput}
          replyTo={parent}
          onCancel={() => setReplying(false)}
          onPosted={() => setReplying(false)}
        />
      )}
    </div>
  )
}
