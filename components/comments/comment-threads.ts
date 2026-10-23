import type { Comment } from '@/lib/comments'

export interface Thread {
  parent: Comment
  /** Live replies only, in conversation order. */
  replies: Comment[]
}

// Stand-in for the deletion time of a parent the server no longer sends. Only its
// non-null-ness matters: it is never displayed.
const UNKNOWN_DELETED_AT = '1970-01-01T00:00:00.000Z'

const byCreatedAt = (a: Comment, b: Comment) => Date.parse(a.createdAt) - Date.parse(b.createdAt)

/**
 * Group a flat comment list into the threads to render: top-level comments by
 * timestamp (ties by creation time, so the live order matches a reload), replies
 * by creation time (conversation order).
 *
 * Only visible threads are returned, with deleted replies already dropped (a
 * deleted reply has nothing under it). A deleted parent with live replies stays,
 * to render as a "Comment deleted" placeholder; with none it is dropped, so an
 * empty result means there is nothing to show.
 *
 * GET /comments omits soft-deleted rows, so after a reload the replies of a
 * deleted parent arrive with no parent in the list. Each such group gets a
 * placeholder parent, already marked deleted, so the replies stay visible under
 * "Comment deleted". (Live, the deleted parent is still in state, flagged by the
 * Realtime UPDATE, and needs no placeholder.)
 */
export function buildThreads(comments: Comment[]): Thread[] {
  const liveRepliesByParent = new Map<string, Comment[]>()
  for (const c of comments) {
    if (c.parentId === null || c.deletedAt !== null) continue
    const group = liveRepliesByParent.get(c.parentId)
    if (group) group.push(c)
    else liveRepliesByParent.set(c.parentId, [c])
  }

  const topLevel = comments.filter((c) => c.parentId === null)
  const knownIds = new Set(topLevel.map((c) => c.id))

  const orphanParents: Comment[] = []
  for (const [parentId, replies] of liveRepliesByParent) {
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
    .map((parent) => ({
      parent,
      replies: [...(liveRepliesByParent.get(parent.id) ?? [])].sort(byCreatedAt),
    }))
    .filter(({ parent, replies }) => parent.deletedAt === null || replies.length > 0)
    .sort(
      (a, b) =>
        a.parent.timestampSeconds - b.parent.timestampSeconds || byCreatedAt(a.parent, b.parent)
    )
}
