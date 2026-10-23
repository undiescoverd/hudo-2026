// Test-only helpers for the comment component and hook tests. Nothing in the app imports this.
import type { Comment } from '@/lib/comments'

export const AGENCY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const VERSION_ID = '33333333-3333-4333-8333-333333333333'
export const AUTHOR_ID = '11111111-1111-4111-8111-111111111111'
export const OTHER_ID = '22222222-2222-4222-8222-222222222222'

let counter = 0

/** A saved, top-level, unresolved, undeleted comment by AUTHOR_ID, overridable per field. */
export function makeComment(over: Partial<Comment> = {}): Comment {
  counter += 1
  return {
    id: `c0000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    videoVersionId: VERSION_ID,
    agencyId: AGENCY_ID,
    userId: AUTHOR_ID,
    content: `Comment body ${counter}`,
    commentType: 'point',
    timestampSeconds: 10,
    endTimestampSeconds: null,
    parentId: null,
    resolved: false,
    resolvedAt: null,
    resolvedBy: null,
    deletedAt: null,
    createdAt: '2026-10-23T10:00:00.000Z',
    authorName: 'Alex Author',
    authorAvatarUrl: null,
    ...over,
  }
}
