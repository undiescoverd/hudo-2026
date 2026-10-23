// components/comments/CommentItem.tsx
'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { COMMENT_BODY_MAX_LENGTH, type Comment } from '@/lib/comments'
import { formatRelativeTime, formatTimecode } from '@/lib/format-time'
import { getCommentPermissions, validateEditDraft } from './comment-permissions'

interface CommentItemProps {
  comment: Comment
  onSeek: (t: number) => void
  isReply?: boolean
  /** The viewer's agency role and user id. Without a role (guests, or a role that
   *  has not loaded) the comment renders read-only, with no actions. */
  viewerRole?: string | null
  viewerUserId?: string | null
  /** Action handlers. A button needs both the permission and its handler.
   *  The async ones reject with a user-facing message when the request fails
   *  (the list has already been rolled back by then). */
  onReply?: () => void
  onResolve?: (resolved: boolean) => Promise<void>
  onEdit?: (content: string) => Promise<void>
  onDelete?: () => Promise<void>
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

/** Get initials from a display name (first letters of up to 2 words, uppercase). */
function nameInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
  return initials.toUpperCase()
}

const actionButtonClass =
  'rounded px-1.5 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
const dangerButtonClass =
  'rounded px-1.5 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300'

type Mode = 'view' | 'edit' | 'confirmDelete'

export function CommentItem({
  comment,
  onSeek,
  isReply = false,
  viewerRole,
  viewerUserId,
  onReply,
  onResolve,
  onEdit,
  onDelete,
}: CommentItemProps) {
  const [mode, setMode] = useState<Mode>('view')
  const [draft, setDraft] = useState(comment.content)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const editRef = useRef<HTMLTextAreaElement>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  // Which trigger to refocus when an inline edit/confirm closes and the comment is
  // still there, so keyboard users are not dropped back onto <body>.
  const refocus = useRef<'edit' | 'delete' | null>(null)

  useEffect(() => {
    if (mode === 'edit') {
      const el = editRef.current
      el?.focus()
      el?.setSelectionRange(el.value.length, el.value.length)
    } else if (mode === 'confirmDelete') {
      cancelDeleteRef.current?.focus()
    } else if (refocus.current) {
      ;(refocus.current === 'edit' ? editButtonRef : deleteButtonRef).current?.focus()
      refocus.current = null
    }
  }, [mode])

  const isDeleted = comment.deletedAt !== null
  const isResolved = comment.resolved
  const authorLabel = comment.authorName ?? 'Unknown'
  const initials =
    comment.authorName && comment.authorName.trim().length > 0
      ? nameInitials(comment.authorName)
      : userInitials(comment.userId)

  if (isDeleted) {
    return (
      <div className={`${isReply ? 'ml-8' : ''} px-3 py-2`}>
        <p className="text-xs italic text-gray-500 dark:text-gray-400">Comment deleted</p>
      </div>
    )
  }

  const perms = getCommentPermissions(comment, { role: viewerRole, userId: viewerUserId })
  const showReply = perms.canReply && !!onReply
  const showResolve = perms.canResolve && !!onResolve
  const showEdit = perms.canEdit && !!onEdit
  const showDelete = perms.canDelete && !!onDelete
  const hasActions = showReply || showResolve || showEdit || showDelete

  const draftProblem = validateEditDraft(draft, comment.content)

  /** Run an action with the buttons disabled meanwhile; a failure shows inline. */
  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      await action()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const startEdit = () => {
    setDraft(comment.content)
    setError(null)
    setMode('edit')
  }

  const cancelEdit = () => {
    refocus.current = 'edit'
    setError(null)
    setMode('view')
  }

  const saveEdit = async () => {
    if (!onEdit || draftProblem !== null) return
    if (await run(() => onEdit(draft.trim()))) {
      refocus.current = 'edit'
      setMode('view')
    }
  }

  const handleEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void saveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }

  const cancelDelete = () => {
    refocus.current = 'delete'
    setMode('view')
  }

  const confirmDelete = async () => {
    if (!onDelete) return
    // The list only changes once the server confirms, so this item stays mounted
    // while "Deleting…" shows, and a failure can be reported right here. Success
    // turns it into the deleted placeholder (or removes it).
    await run(onDelete)
    refocus.current = 'delete'
    setMode('view')
  }

  const toggleResolve = () => {
    if (onResolve) void run(() => onResolve(!isResolved))
  }

  return (
    <div
      className={[
        'group flex gap-3 rounded-lg p-3 transition-colors',
        isReply ? 'ml-8' : '',
        isResolved
          ? 'bg-green-50/60 dark:bg-green-950/20'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
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
        {initials}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {authorLabel}
          </span>

          {/* Timestamp badge — click to seek */}
          <button
            type="button"
            onClick={() => onSeek(comment.timestampSeconds)}
            className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700 hover:bg-blue-100 hover:text-blue-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-blue-900/40 dark:hover:text-blue-400"
            aria-label={`Seek to ${formatTimecode(comment.timestampSeconds)}`}
          >
            {formatTimecode(comment.timestampSeconds)}
          </button>

          {isResolved && (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
              Resolved
            </span>
          )}

          <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
            {formatRelativeTime(comment.createdAt)}
          </span>
        </div>

        {mode === 'edit' ? (
          <div className="mt-1">
            <textarea
              ref={editRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleEditKeyDown}
              rows={3}
              disabled={busy}
              aria-label={`Edit comment by ${authorLabel}`}
              className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span
                className={`text-xs ${
                  draft.trim().length > COMMENT_BODY_MAX_LENGTH
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {draft.trim().length} / {COMMENT_BODY_MAX_LENGTH}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={busy}
                  className={actionButtonClass}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveEdit()}
                  disabled={busy || draftProblem !== null}
                  className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <p
            className={`mt-1 whitespace-pre-wrap text-sm ${
              isResolved ? 'text-gray-600 dark:text-gray-400' : 'text-gray-800 dark:text-gray-200'
            }`}
          >
            {comment.content}
          </p>
        )}

        {mode === 'confirmDelete' && (
          <div
            role="group"
            aria-label="Confirm delete"
            className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-2 py-1.5 text-xs dark:bg-red-950/30"
          >
            <span className="text-red-800 dark:text-red-300">
              Delete this comment? This can&apos;t be undone.
            </span>
            <button
              ref={cancelDeleteRef}
              type="button"
              onClick={cancelDelete}
              disabled={busy}
              className={actionButtonClass}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              disabled={busy}
              className={dangerButtonClass}
            >
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        )}

        {mode === 'view' && hasActions && (
          <div role="group" aria-label="Comment actions" className="mt-1.5 flex flex-wrap gap-1">
            {showReply && (
              <button
                type="button"
                onClick={onReply}
                disabled={busy}
                aria-label={`Reply to ${authorLabel}`}
                className={actionButtonClass}
              >
                Reply
              </button>
            )}
            {showResolve && (
              <button
                type="button"
                onClick={toggleResolve}
                disabled={busy}
                aria-label={`${isResolved ? 'Unresolve' : 'Resolve'} comment by ${authorLabel}`}
                className={actionButtonClass}
              >
                {isResolved ? 'Unresolve' : 'Resolve'}
              </button>
            )}
            {showEdit && (
              <button
                ref={editButtonRef}
                type="button"
                onClick={startEdit}
                disabled={busy}
                aria-label={`Edit comment by ${authorLabel}`}
                className={actionButtonClass}
              >
                Edit
              </button>
            )}
            {showDelete && (
              <button
                ref={deleteButtonRef}
                type="button"
                onClick={() => {
                  setError(null)
                  setMode('confirmDelete')
                }}
                disabled={busy}
                aria-label={`Delete comment by ${authorLabel}`}
                className={dangerButtonClass}
              >
                Delete
              </button>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
