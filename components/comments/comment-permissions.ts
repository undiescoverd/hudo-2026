import { COMMENT_BODY_MAX_LENGTH, type Comment } from '@/lib/comments'
import { isAgentClassRole } from '@/lib/talent-roster'

/** Who is looking at the comment. Guests and not-yet-loaded viewers pass nothing. */
export interface CommentViewer {
  role?: string | null
  userId?: string | null
}

export interface CommentPermissions {
  canReply: boolean
  canResolve: boolean
  canEdit: boolean
  canDelete: boolean
}

const NO_PERMISSIONS: CommentPermissions = {
  canReply: false,
  canResolve: false,
  canEdit: false,
  canDelete: false,
}

// Agency membership roles (lib/auth UserRole). An unknown string is NOT a member:
// `roleAtLeast` would treat it as more privileged than everyone, so we match explicitly.
const MEMBER_ROLES = ['owner', 'admin_agent', 'agent', 'talent']

/** Optimistic comments carry `temp-<uuid>` ids until the POST response swaps them out. */
export const TEMP_COMMENT_ID_PREFIX = 'temp-'

/**
 * Which actions the UI offers on a comment. This only decides which controls to
 * show; the API routes re-check every action and stay the source of truth.
 *
 * - Reply: any member, top-level comments only (replies are one level deep, migration 0008)
 * - Resolve/Unresolve: agent and above
 * - Edit: the author only
 * - Delete: the author, or agent and above on any comment
 *
 * No role (guests, or a role that has not loaded) means no actions. A deleted
 * comment, or one that has not been saved yet, offers none either.
 */
export function getCommentPermissions(comment: Comment, viewer: CommentViewer): CommentPermissions {
  const { role, userId } = viewer
  if (!role || !userId || !MEMBER_ROLES.includes(role)) return NO_PERMISSIONS
  if (comment.deletedAt !== null || comment.id.startsWith(TEMP_COMMENT_ID_PREFIX)) {
    return NO_PERMISSIONS
  }

  const isAuthor = comment.userId === userId
  const agentPlus = isAgentClassRole(role)

  return {
    canReply: comment.parentId === null,
    canResolve: agentPlus,
    canEdit: isAuthor,
    canDelete: isAuthor || agentPlus,
  }
}

/** Why an edit draft cannot be saved, or null when it can. */
export function validateEditDraft(draft: string, current: string): string | null {
  const trimmed = draft.trim()
  if (trimmed.length === 0) return 'Comment cannot be empty'
  if (trimmed.length > COMMENT_BODY_MAX_LENGTH) {
    return `Comment must be ${COMMENT_BODY_MAX_LENGTH} characters or fewer`
  }
  if (trimmed === current.trim()) return 'No changes to save'
  return null
}
