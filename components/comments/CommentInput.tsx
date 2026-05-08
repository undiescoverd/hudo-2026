'use client'

import { useCallback, useState, type KeyboardEvent } from 'react'
import { COMMENT_BODY_MAX_LENGTH, type Comment } from '@/lib/comments'
import { useVideoPlayerContext } from '@/components/player/VideoPlayer'

interface CommentInputProps {
  videoId: string
  versionId: string
  agencyId: string
  userId: string
  onOptimisticInsert: (comment: Comment) => void
  onOptimisticRollback: (tempId: string) => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function CommentInput({
  videoId,
  versionId,
  agencyId,
  userId,
  onOptimisticInsert,
  onOptimisticRollback,
}: CommentInputProps) {
  const player = useVideoPlayerContext()
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasRange =
    player.rangeIn !== null && player.rangeOut !== null && player.rangeOut > player.rangeIn
  const commentType: 'point' | 'range' = hasRange ? 'range' : 'point'
  const startSec = hasRange ? (player.rangeIn as number) : player.currentTime
  const endSec = hasRange ? (player.rangeOut as number) : null

  const trimmed = body.trim()
  const overLimit = trimmed.length > COMMENT_BODY_MAX_LENGTH
  const canSubmit = !submitting && trimmed.length > 0 && !overLimit

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setError(null)
    setSubmitting(true)

    const tempId = `temp-${crypto.randomUUID()}`
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
      parentId: null,
      resolved: false,
      resolvedAt: null,
      resolvedBy: null,
      deletedAt: null,
      createdAt: nowIso,
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
          body: JSON.stringify({
            content: trimmed,
            comment_type: commentType,
            timestamp_seconds: startSec,
            ...(endSec !== null ? { end_timestamp_seconds: endSec } : {}),
          }),
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
    versionId,
    videoId,
    agencyId,
    userId,
    onOptimisticInsert,
    onOptimisticRollback,
  ])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const stamp = hasRange
    ? `${formatTime(startSec)} – ${formatTime(endSec as number)}`
    : formatTime(startSec)

  return (
    <div className="border-t border-gray-200 p-3 dark:border-gray-800">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {stamp}
        </span>
        <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {commentType}
        </span>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        aria-label="Comment"
        placeholder="Leave a comment… (Enter to send, Shift+Enter for newline)"
        className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
      />

      <div className="mt-2 flex items-center justify-between">
        <span
          className={`text-xs ${overLimit ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}
        >
          {trimmed.length} / {COMMENT_BODY_MAX_LENGTH}
        </span>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Posting…' : 'Post'}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
