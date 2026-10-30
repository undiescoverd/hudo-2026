// components/comments/CommentThread.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import type { Comment } from '@/lib/comments'
import { CommentItem } from './CommentItem'
import { CommentInput, type CommentInputProps } from './CommentInput'

interface CommentThreadProps {
  parent: Comment
  /** Live replies, already filtered and ordered (see buildThreads). */
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

/**
 * A top-level comment with its replies. A deleted parent renders as a "Comment
 * deleted" placeholder (CommentItem) with its replies intact.
 */
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
  const replyButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)

  // Closing the composer (Cancel, Escape, or a posted reply) removes the focused
  // textarea, so hand focus back to the Reply button that opened it.
  const closeReply = () => {
    returnFocus.current = true
    setReplying(false)
  }
  useEffect(() => {
    if (!replying && returnFocus.current) {
      returnFocus.current = false
      replyButtonRef.current?.focus()
    }
  }, [replying])

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
        replyButtonRef={replyButtonRef}
      />
      {replies.map((reply) => (
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
          onCancel={closeReply}
          onPosted={closeReply}
        />
      )}
    </div>
  )
}
