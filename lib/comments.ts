import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserRole } from '@/lib/auth'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Comment {
  id: string
  videoVersionId: string
  agencyId: string
  userId: string
  content: string
  commentType: 'point' | 'range'
  timestampSeconds: number
  endTimestampSeconds: number | null
  parentId: string | null
  resolved: boolean
  resolvedAt: string | null
  resolvedBy: string | null
  deletedAt: string | null
  createdAt: string
}

export interface CreateCommentInput {
  content: string
  comment_type: 'point' | 'range'
  timestamp_seconds: number
  end_timestamp_seconds?: number
  parent_id?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const COMMENT_BODY_MAX_LENGTH = 2000
export const COMMENTS_GET_RATE_LIMIT = 60 // per minute
export const COMMENTS_POST_RATE_LIMIT = 30 // per minute
export const COMMENTS_PATCH_RATE_LIMIT = 30
export const COMMENTS_DELETE_RATE_LIMIT = 30
export const COMMENTS_RATE_WINDOW = 60

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validates the request body for creating a comment.
 * Returns a parsed CreateCommentInput on success, or an error string on failure.
 */
export function validateCreateInput(body: unknown): CreateCommentInput | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be an object'
  }

  const b = body as Record<string, unknown>

  if (typeof b.content !== 'string' || b.content.trim() === '') {
    return 'content is required'
  }
  if (b.content.length > COMMENT_BODY_MAX_LENGTH) {
    return `content must be ${COMMENT_BODY_MAX_LENGTH} characters or fewer`
  }

  if (b.comment_type !== 'point' && b.comment_type !== 'range') {
    return "comment_type must be 'point' or 'range'"
  }

  if (typeof b.timestamp_seconds !== 'number' || !Number.isFinite(b.timestamp_seconds)) {
    return 'timestamp_seconds must be a number'
  }
  if (b.timestamp_seconds < 0) {
    return 'timestamp_seconds must be >= 0'
  }

  if (b.comment_type === 'range') {
    if (typeof b.end_timestamp_seconds !== 'number' || !Number.isFinite(b.end_timestamp_seconds)) {
      return 'end_timestamp_seconds is required for range comments'
    }
    if (b.end_timestamp_seconds < 0) {
      return 'end_timestamp_seconds must be >= 0'
    }
    if (b.end_timestamp_seconds <= b.timestamp_seconds) {
      return 'end_timestamp_seconds must be greater than timestamp_seconds'
    }
  }

  if (b.parent_id !== undefined && b.parent_id !== null) {
    if (typeof b.parent_id !== 'string' || !UUID_RE.test(b.parent_id)) {
      return 'parent_id must be a valid UUID'
    }
  }

  const result: CreateCommentInput = {
    content: b.content,
    comment_type: b.comment_type,
    timestamp_seconds: b.timestamp_seconds,
  }

  if (typeof b.end_timestamp_seconds === 'number') {
    result.end_timestamp_seconds = b.end_timestamp_seconds
  }

  if (typeof b.parent_id === 'string') {
    result.parent_id = b.parent_id
  }

  return result
}

// ---------------------------------------------------------------------------
// Access helper
// ---------------------------------------------------------------------------

type AccessSuccess = { membership: { role: UserRole }; agencyId: string }
type AccessError = { error: string; status: number }

/**
 * Validates that the given user has access to the specified video version.
 *
 * Checks:
 * 1. Video exists (403 if not — avoids leaking existence)
 * 2. User has a membership in the video's agency (403 if not)
 * 3. Talent visibility: talent users can only access their own videos (403 if violated)
 * 4. Version belongs to the video (404 if not)
 *
 * Returns { membership, agencyId } on success, or { error, status } on failure.
 */
export async function getVideoVersionWithAccess(
  admin: SupabaseClient,
  userId: string,
  videoId: string,
  versionId: string
): Promise<AccessSuccess | AccessError> {
  const { data: video, error: videoError } = await admin
    .from('videos')
    .select('id, agency_id, talent_id')
    .eq('id', videoId)
    .single()

  if (videoError || !video) {
    return { error: 'Access denied', status: 403 }
  }

  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', userId)
    .eq('agency_id', video.agency_id)
    .single()

  if (!membership) {
    return { error: 'Access denied', status: 403 }
  }

  if (membership.role === 'talent' && video.talent_id !== userId) {
    return { error: 'Access denied', status: 403 }
  }

  const { data: version, error: versionError } = await admin
    .from('video_versions')
    .select('id')
    .eq('id', versionId)
    .eq('video_id', videoId)
    .single()

  if (versionError || !version) {
    return { error: 'Version not found', status: 404 }
  }

  return { membership: { role: membership.role as UserRole }, agencyId: video.agency_id }
}
