import { createAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { type NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import {
  validateCreateInput,
  getVideoVersionWithAccess,
  rowToComment,
  COMMENTS_GET_RATE_LIMIT,
  COMMENTS_POST_RATE_LIMIT,
  COMMENTS_RATE_WINDOW,
} from '@/lib/comments'
import { enqueueCommentNotification } from '@/lib/notifications'
import { checkRateLimit } from '@/lib/api-helpers'
import { isValidUUID } from '@/lib/validation'

const REPLY_DEPTH_ERROR = 'Replies can only be one level deep'

/** Open-comment counts for the versions before `versionId` (caller already authorised). */
async function earlierOpenResponse(
  admin: ReturnType<typeof createAdminClient>,
  videoId: string,
  versionId: string
) {
  const { data: versions, error: versionsError } = await admin
    .from('video_versions')
    .select('id, version_number')
    .eq('video_id', videoId)

  if (versionsError) {
    console.error('[comments:GET] earlierOpen versions query failed:', versionsError)
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 })
  }

  const current = (versions ?? []).find((v) => v.id === versionId)
  const earlier = (versions ?? [])
    .filter((v) => current && v.version_number < current.version_number)
    .sort((a, b) => a.version_number - b.version_number)
  if (earlier.length === 0) return NextResponse.json({ earlierOpen: [] })

  const { data: open, error: openError } = await admin
    .from('comments')
    .select('video_version_id')
    .in(
      'video_version_id',
      earlier.map((v) => v.id)
    )
    .eq('resolved', false)
    .is('deleted_at', null)
    .is('parent_id', null)

  if (openError) {
    console.error('[comments:GET] earlierOpen comments query failed:', openError)
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 })
  }

  const counts = new Map<string, number>()
  for (const row of open ?? []) {
    counts.set(row.video_version_id, (counts.get(row.video_version_id) ?? 0) + 1)
  }
  return NextResponse.json({
    earlierOpen: earlier
      .filter((v) => counts.has(v.id))
      .map((v) => ({
        versionId: v.id,
        versionNumber: v.version_number,
        openCount: counts.get(v.id) as number,
      })),
  })
}

/**
 * GET /api/videos/:videoId/versions/:versionId/comments
 *
 * Returns all non-deleted comments for the given video version, ordered by timestamp.
 *
 * Security:
 * - Authenticated users only (401)
 * - User must have a membership in the video's agency (403)
 * - Talent users can only see comments on their own videos (403)
 * - soft-deleted comments (deleted_at IS NOT NULL) are excluded
 *
 * `?earlierOpen=1` instead returns { earlierOpen: [{ versionId, versionNumber, openCount }] }:
 * the open (unresolved, non-deleted, top-level) comment count for each EARLIER version of the
 * same video, omitting versions with none. It runs behind the same auth + access check, and
 * only ever covers versions of the video the caller was just authorised for.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { videoId: string; versionId: string } }
) {
  const { videoId, versionId } = params

  if (!isValidUUID(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID format' }, { status: 400 })
  }
  if (!isValidUUID(versionId)) {
    return NextResponse.json({ error: 'Invalid version ID format' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[comments:GET] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Fail-closed on Redis error — see lib/api-helpers.ts for the posture rationale.
  const getRl = await checkRateLimit(
    `comments:get:user:${user.id}`,
    COMMENTS_GET_RATE_LIMIT,
    COMMENTS_RATE_WINDOW,
    'comments:GET',
    'Too many requests. Please try again later.',
    'fail-closed'
  )
  if (getRl) return getRl

  const admin = createAdminClient()

  const accessResult = await getVideoVersionWithAccess(admin, user.id, videoId, versionId)
  if ('error' in accessResult) {
    return NextResponse.json({ error: accessResult.error }, { status: accessResult.status })
  }

  if (new URL(request.url).searchParams.get('earlierOpen') === '1') {
    return earlierOpenResponse(admin, videoId, versionId)
  }

  const { data: comments, error: commentsError } = await admin
    .from('comments')
    .select(
      'id, video_version_id, agency_id, user_id, content, comment_type, timestamp_seconds, end_timestamp_seconds, parent_id, resolved, resolved_at, resolved_by, deleted_at, created_at, users!comments_user_id_fkey(full_name, avatar_url)'
    )
    .eq('video_version_id', versionId)
    .is('deleted_at', null)
    .order('timestamp_seconds', { ascending: true })

  if (commentsError) {
    console.error('[comments:GET] DB query failed:', commentsError)
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 })
  }

  return NextResponse.json({ comments: (comments ?? []).map(rowToComment) })
}

/**
 * POST /api/videos/:videoId/versions/:versionId/comments
 *
 * Creates a new comment on the given video version.
 *
 * Security:
 * - Authenticated users only (401)
 * - User must have a membership in the video's agency (403)
 * - Talent users can only comment on their own videos (403)
 * - Content validated: required, max 2000 chars (COMMENT_BODY_MAX_LENGTH)
 * - comment_type must be 'point' or 'range'
 * - end_timestamp_seconds required for range comments
 * - parent_id must be a valid UUID if provided
 * - Replies are one level deep: a parent that is itself a reply is rejected (400),
 *   mirroring the 0008 depth trigger (see the 23514 backstop below)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { videoId: string; versionId: string } }
) {
  const { videoId, versionId } = params

  if (!isValidUUID(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID format' }, { status: 400 })
  }
  if (!isValidUUID(versionId)) {
    return NextResponse.json({ error: 'Invalid version ID format' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[comments:POST] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Fail-closed on Redis error — see lib/api-helpers.ts for the posture rationale.
  const postRl = await checkRateLimit(
    `comments:post:user:${user.id}`,
    COMMENTS_POST_RATE_LIMIT,
    COMMENTS_RATE_WINDOW,
    'comments:POST',
    'Too many requests. Please try again later.',
    'fail-closed'
  )
  if (postRl) return postRl

  const admin = createAdminClient()

  const accessResult = await getVideoVersionWithAccess(admin, user.id, videoId, versionId)
  if ('error' in accessResult) {
    return NextResponse.json({ error: accessResult.error }, { status: accessResult.status })
  }

  const { agencyId } = accessResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const input = validateCreateInput(body)
  if (typeof input === 'string') {
    return NextResponse.json({ error: input }, { status: 400 })
  }

  // Validate parent_id if provided
  if (input.parent_id) {
    const { data: parent, error: parentError } = await admin
      .from('comments')
      .select('id, video_version_id, agency_id, parent_id, deleted_at')
      .eq('id', input.parent_id)
      .single()

    if (parentError || !parent) {
      return NextResponse.json({ error: 'Parent comment not found' }, { status: 400 })
    }
    if (parent.deleted_at !== null) {
      return NextResponse.json({ error: 'Cannot reply to a deleted comment' }, { status: 400 })
    }
    if (parent.video_version_id !== versionId) {
      return NextResponse.json(
        { error: 'Parent comment belongs to a different version' },
        { status: 400 }
      )
    }
    if (parent.agency_id !== agencyId) {
      return NextResponse.json(
        { error: 'Parent comment belongs to a different agency' },
        { status: 400 }
      )
    }
    // Replies are one level deep. Checked last so a foreign parent's structure
    // is never revealed. Without this the insert trips the 0008 depth trigger.
    if (parent.parent_id !== null) {
      return NextResponse.json({ error: REPLY_DEPTH_ERROR }, { status: 400 })
    }
  }

  const { data: comment, error: insertError } = await admin
    .from('comments')
    .insert({
      video_version_id: versionId,
      agency_id: agencyId,
      user_id: user.id,
      content: input.content,
      comment_type: input.comment_type,
      timestamp_seconds: input.timestamp_seconds,
      end_timestamp_seconds: input.end_timestamp_seconds ?? null,
      parent_id: input.parent_id ?? null,
    })
    .select('*, users!comments_user_id_fkey(full_name, avatar_url)')
    .single()

  // Race backstop: the parent can become a reply between the check above and
  // the insert. Postgres then raises the 0008 depth trigger as ERRCODE 23514
  // (check_violation). Only a reply can trip it, so a 23514 on a top-level insert
  // is some other constraint and stays a 500.
  if (input.parent_id && insertError?.code === '23514') {
    // Logged so a check violation that is not the depth trigger (and so is mislabelled
    // here) stays visible instead of being reported to the client as a client error.
    console.error('[comments:POST] Reply insert hit 23514, returning 400:', insertError)
    return NextResponse.json({ error: REPLY_DEPTH_ERROR }, { status: 400 })
  }

  if (insertError || !comment) {
    console.error('[comments:POST] Insert failed:', insertError)
    return NextResponse.json({ error: 'Failed to create comment' }, { status: 500 })
  }

  // Await enqueue so the notification row is definitely inserted before the
  // function exits (serverless: promises after return may not complete).
  // .catch() ensures a notification failure never breaks the 201 response.
  await enqueueCommentNotification({
    agencyId,
    videoId,
    commentId: comment.id,
    commentAuthorId: user.id,
  }).catch((err) => {
    console.error('[comments:POST] Notification enqueue error:', {
      videoId,
      commentId: comment.id,
      err,
    })
    Sentry.captureException(err)
  })

  return NextResponse.json({ comment: rowToComment(comment) }, { status: 201 })
}
