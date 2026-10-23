'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { COMMENT_BODY_MAX_LENGTH, type Comment } from '@/lib/comments'
import { formatTimecode } from '@/lib/format-time'
import { useVideoPlayerContext } from '@/components/player/VideoPlayer'
import { TEMP_COMMENT_ID_PREFIX } from './comment-permissions'

export interface CommentInputProps {
  videoId: string
  versionId: string
  agencyId: string
  userId: string
  onOptimisticInsert: (comment: Comment) => void
  onOptimisticRollback: (tempId: string) => void
  /** Display name for the optimistic comment's author. The canonical POST
   *  response (which carries the real name via the users embed) replaces
   *  the temp row, so this is a purely cosmetic bridge for the brief window
   *  before that response arrives. */
  currentUserName?: string | null
  /** Set to post a reply: the comment is sent with `parent_id` and takes the
   *  parent's timestamp (a reply continues that moment's thread, it is not a
   *  new anchor on the timeline). */
  replyTo?: Comment | null
  /** Reply composer only: called when the user backs out (Cancel or Escape). */
  onCancel?: () => void
  /** Reply composer only: called once the reply has been posted. */
  onPosted?: () => void
}

/** The POST body for the comments collection endpoint. */
export function buildCommentPayload(input: {
  content: string
  commentType: 'point' | 'range'
  startSec: number
  endSec: number | null
  parentId: string | null
}): Record<string, unknown> {
  return {
    content: input.content,
    comment_type: input.commentType,
    timestamp_seconds: input.startSec,
    ...(input.endSec !== null ? { end_timestamp_seconds: input.endSec } : {}),
    ...(input.parentId !== null ? { parent_id: input.parentId } : {}),
  }
}

export function CommentInput({
  videoId,
  versionId,
  agencyId,
  userId,
  onOptimisticInsert,
  onOptimisticRollback,
  currentUserName,
  replyTo = null,
  onCancel,
  onPosted,
}: CommentInputProps) {
  const player = useVideoPlayerContext()
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isReply = replyTo !== null
  const parentId = replyTo?.id ?? null
  const hasRange =
    !isReply &&
    player.rangeIn !== null &&
    player.rangeOut !== null &&
    player.rangeOut > player.rangeIn
  const commentType: 'point' | 'range' = hasRange ? 'range' : 'point'
  const startSec = replyTo
    ? replyTo.timestampSeconds
    : hasRange
      ? (player.rangeIn as number)
      : player.currentTime
  const endSec = hasRange ? (player.rangeOut as number) : null

  // A reply composer opens on demand, so put the caret in it.
  useEffect(() => {
    if (isReply) textareaRef.current?.focus()
  }, [isReply])

  const trimmed = body.trim()
  const overLimit = trimmed.length > COMMENT_BODY_MAX_LENGTH
  const canSubmit = !submitting && trimmed.length > 0 && !overLimit

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setError(null)
    setSubmitting(true)

    const tempId = `${TEMP_COMMENT_ID_PREFIX}${crypto.randomUUID()}`
    const nowIso = new Date().toISOString()
    const optimistic: Comment = {
      id: tempId,
      videoVersionId: versionId,
      agencyId,
      userId,
      content: trimmed,
      commentType,
      timestampSeconds: startSec,
      endTimestampSeconds: endSec,
      parentId,
      resolved: false,
      resolvedAt: null,
      resolvedBy: null,
      deletedAt: null,
      createdAt: nowIso,
      authorName: currentUserName ?? null,
      authorAvatarUrl: null,
    }

    const originalBody = body
    onOptimisticInsert(optimistic)
    setBody('')

    try {
      const res = await fetch(
        `/api/videos/${encodeURIComponent(videoId)}/versions/${encodeURIComponent(versionId)}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            buildCommentPayload({ content: trimmed, commentType, startSec, endSec, parentId })
          ),
        }
      )

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errBody.error ?? `Failed to post comment (${res.status})`)
      }

      // Success: swap the temp for the canonical comment returned by the server.
      // Insert canonical first, then remove temp so the comment never disappears from the DOM.
      let data: { comment: Comment }
      try {
        data = (await res.json()) as { comment: Comment }
        if (!data?.comment?.id) throw new Error('Unexpected response shape')
      } catch {
        throw new Error('Unexpected response from server')
      }
      // CommentPanel.handleInsert dedupes by id, so a Realtime echo of the same comment is a no-op.
      onOptimisticInsert(data.comment)
      onOptimisticRollback(tempId)
      onPosted?.()
    } catch (err) {
      onOptimisticRollback(tempId)
      setError(err instanceof Error ? err.message : 'Failed to post comment')
      setBody(originalBody) // restore original so the user can retry without losing formatting
    } finally {
      setSubmitting(false)
    }
  }, [
    body,
    canSubmit,
    trimmed,
    commentType,
    startSec,
    endSec,
    parentId,
    versionId,
    videoId,
    agencyId,
    userId,
    currentUserName,
    onOptimisticInsert,
    onOptimisticRollback,
    onPosted,
  ])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault()
      onCancel()
    }
  }

  const stamp = hasRange
    ? `${formatTimecode(startSec)} – ${formatTimecode(endSec as number)}`
    : formatTimecode(startSec)

  const replyLabel = `Reply to ${replyTo?.authorName ?? 'Unknown'}`

  return (
    <div
      className={
        isReply
          ? 'mx-3 mb-2 ml-11 rounded-lg border border-gray-200 p-3 dark:border-gray-700'
          : 'border-t border-gray-200 p-3 dark:border-gray-800'
      }
    >
      {isReply ? (
        <p className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">{replyLabel}</p>
      ) : (
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {stamp}
          </span>
          <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {commentType}
          </span>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        aria-label={isReply ? replyLabel : 'Comment'}
        placeholder={
          isReply
            ? 'Write a reply… (Enter to send, Shift+Enter for newline, Esc to cancel)'
            : 'Leave a comment… (Enter to send, Shift+Enter for newline)'
        }
        className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
      />

      <div className="mt-2 flex items-center justify-between">
        <span
          className={`text-xs ${overLimit ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}
        >
          {trimmed.length} / {COMMENT_BODY_MAX_LENGTH}
        </span>
        <div className="flex gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Posting…' : isReply ? 'Reply' : 'Post'}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
