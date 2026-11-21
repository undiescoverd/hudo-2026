// components/comments/CommentItem.tsx
'use client'

import { useEffect, useReducer, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { COMMENT_BODY_MAX_LENGTH, type Comment } from '@/lib/comments'
import { formatRelativeTime, formatTimecode } from '@/lib/format-time'
import { editKeyAction } from './comment-keys'
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
  /** Lets the thread return focus to the Reply button when its composer closes. */
  replyButtonRef?: Ref<HTMLButtonElement>
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

export interface ItemState {
  mode: Mode
  /** An action is in flight: its buttons are disabled. */
  busy: boolean
  /** The last failed action's message, shown inline. */
  error: string | null
}

export type ItemEvent =
  | { type: 'open'; mode: 'edit' | 'confirmDelete' }
  | { type: 'close' }
  | { type: 'start' }
  | { type: 'succeeded' }
  | { type: 'failed'; message: string; mode: Mode }

export const INITIAL_ITEM_STATE: ItemState = { mode: 'view', busy: false, error: null }

/**
 * The item's inline edit / delete-confirm / action states.
 * - open: enter the edit box or the delete confirm (clears any old error)
 * - close: back to viewing without acting (Cancel)
 * - start: an action began
 * - succeeded: the action finished, back to viewing
 * - failed: the action failed; show the message and go to `mode` (the edit box
 *   stays open so the draft can be retried; a failed delete returns to viewing)
 */
export function itemReducer(state: ItemState, event: ItemEvent): ItemState {
  switch (event.type) {
    case 'open':
      return { ...state, mode: event.mode, error: null }
    case 'close':
      return { ...state, mode: 'view', error: null }
    case 'start':
      return { ...state, busy: true, error: null }
    case 'succeeded':
      return { mode: 'view', busy: false, error: null }
    case 'failed':
      return { mode: event.mode, busy: false, error: event.message }
  }
}

export function CommentItem({
  comment,
  onSeek,
  isReply = false,
  viewerRole,
  viewerUserId,
  onReply,
  replyButtonRef,
  onResolve,
  onEdit,
  onDelete,
}: CommentItemProps) {
  const [{ mode, busy, error }, dispatch] = useReducer(itemReducer, INITIAL_ITEM_STATE)
  const [draft, setDraft] = useState(comment.content)

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

  // A failed save keeps the edit box open; put the caret back so the draft can be
  // retried even if clicking Save moved focus to a button that is now disabled.
  useEffect(() => {
    if (error && mode === 'edit') editRef.current?.focus()
  }, [error, mode])

  const isDeleted = comment.deletedAt !== null
  const isResolved = comment.resolved
  const authorLabel = comment.authorName ?? 'Unknown'
  const initials =
    comment.authorName && comment.authorName.trim().length > 0
      ? nameInitials(comment.authorName)
      : userInitials(comment.userId)

  if (isDeleted) {
    return (
      // Only top-level comments ever render deleted: a deleted reply is dropped from its thread.
      <div className="px-3 py-2">
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

  /** Run an action with the buttons disabled meanwhile; a failure shows inline and goes to `failMode`. */
  async function run(action: () => Promise<void>, failMode: Mode): Promise<void> {
    dispatch({ type: 'start' })
    try {
      await action()
      dispatch({ type: 'succeeded' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      dispatch({ type: 'failed', message, mode: failMode })
    }
  }

  const startEdit = () => {
    setDraft(comment.content)
    dispatch({ type: 'open', mode: 'edit' })
  }

  const cancelEdit = () => {
    if (busy) return
    refocus.current = 'edit'
    dispatch({ type: 'close' })
  }

  const saveEdit = () => {
    if (!onEdit || busy || draftProblem !== null) return
    refocus.current = 'edit'
    void run(() => onEdit(draft.trim()), 'edit')
  }

  const handleEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const action = editKeyAction(e.key, e.shiftKey)
    if (!action) return
    e.preventDefault()
    if (action === 'save') saveEdit()
    else cancelEdit()
  }

  const cancelDelete = () => {
    refocus.current = 'delete'
    dispatch({ type: 'close' })
  }

  // The list only changes once the server confirms, so this item stays mounted
  // while "Deleting…" shows, and a failure can be reported right here. Success
  // turns it into the deleted placeholder (or removes it).
  const confirmDelete = () => {
    if (!onDelete || busy) return
    refocus.current = 'delete'
    void run(onDelete, 'view')
  }

  const toggleResolve = () => {
    if (onResolve) void run(() => onResolve(!isResolved), 'view')
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
              // readOnly, not disabled: a disabled textarea drops focus, and a failed save
              // must leave the caret where it was so the draft can be retried.
              readOnly={busy}
              aria-label={`Edit comment by ${authorLabel}`}
              className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 read-only:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
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
                  onClick={saveEdit}
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
              onClick={confirmDelete}
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
                ref={replyButtonRef}
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
                onClick={() => dispatch({ type: 'open', mode: 'confirmDelete' })}
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
