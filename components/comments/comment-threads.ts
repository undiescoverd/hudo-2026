import type { Comment } from '@/lib/comments'

export interface Thread {
  parent: Comment
  replies: Comment[]
}

// Stand-in for the deletion time of a parent the server no longer sends. Only its
// non-null-ness matters: it is never displayed.
const UNKNOWN_DELETED_AT = '1970-01-01T00:00:00.000Z'

const byCreatedAt = (a: Comment, b: Comment) => Date.parse(a.createdAt) - Date.parse(b.createdAt)

/** Replies worth showing: a deleted reply has nothing under it, so it is hidden. */
export function visibleReplies(replies: Comment[]): Comment[] {
  return replies.filter((r) => r.deletedAt === null)
}

/**
 * A thread renders unless its parent is deleted and no live reply remains. A
 * deleted parent with replies stays, as a "Comment deleted" placeholder.
 */
export function isThreadVisible(parent: Comment, replies: Comment[]): boolean {
  return parent.deletedAt === null || visibleReplies(replies).length > 0
}

/**
 * Group a flat comment list into threads: top-level comments by timestamp,
 * replies by creation time (conversation order).
 *
 * GET /comments omits soft-deleted rows, so after a reload the replies of a
 * deleted parent arrive with no parent in the list. Each such group gets a
 * placeholder parent, already marked deleted, so the replies stay visible under
 * "Comment deleted". (Live, the deleted parent is still in state, flagged by the
 * Realtime UPDATE, and needs no placeholder.)
 */
export function buildThreads(comments: Comment[]): Thread[] {
  const repliesByParent = new Map<string, Comment[]>()
  for (const c of comments) {
    if (c.parentId === null) continue
    const group = repliesByParent.get(c.parentId)
    if (group) group.push(c)
    else repliesByParent.set(c.parentId, [c])
  }

  const topLevel = comments.filter((c) => c.parentId === null)
  const knownIds = new Set(topLevel.map((c) => c.id))

  const orphanParents: Comment[] = []
  for (const [parentId, replies] of repliesByParent) {
    if (knownIds.has(parentId)) continue
    const first = [...replies].sort(byCreatedAt)[0]
    orphanParents.push({
      id: parentId,
      videoVersionId: first.videoVersionId,
      agencyId: first.agencyId,
      userId: '',
      content: '',
      commentType: 'point',
      timestampSeconds: Math.min(...replies.map((r) => r.timestampSeconds)),
      endTimestampSeconds: null,
      parentId: null,
      resolved: false,
      resolvedAt: null,
      resolvedBy: null,
      deletedAt: UNKNOWN_DELETED_AT,
      createdAt: first.createdAt,
      authorName: null,
      authorAvatarUrl: null,
    })
  }

  return [...topLevel, ...orphanParents]
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
    .map((parent) => ({
      parent,
      replies: [...(repliesByParent.get(parent.id) ?? [])].sort(byCreatedAt),
    }))
}
