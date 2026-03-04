import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import {
  validateCreateInput,
  getVideoVersionWithAccess,
  COMMENTS_GET_RATE_LIMIT,
  COMMENTS_POST_RATE_LIMIT,
  COMMENTS_RATE_WINDOW,
} from '@/lib/comments'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { videoId: string; versionId: string } }
) {
  const { videoId, versionId } = params

  if (!UUID_RE.test(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID format' }, { status: 400 })
  }
  if (!UUID_RE.test(versionId)) {
    return NextResponse.json({ error: 'Invalid version ID format' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('[comments:GET] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options)
        }
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  try {
    const { rateLimit } = await import('@/lib/redis')
    const remaining = await rateLimit(
      `comments:get:user:${user.id}`,
      COMMENTS_GET_RATE_LIMIT,
      COMMENTS_RATE_WINDOW
    )
    if (remaining === -1) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(COMMENTS_RATE_WINDOW) } }
      )
    }
  } catch (err) {
    console.error('[comments:GET] Rate limit check failed, failing-closed:', err)
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(COMMENTS_RATE_WINDOW) } }
    )
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const accessResult = await getVideoVersionWithAccess(admin, user.id, videoId, versionId)
  if ('error' in accessResult) {
    return NextResponse.json({ error: accessResult.error }, { status: accessResult.status })
  }

  const { data: comments, error: commentsError } = await admin
    .from('comments')
    .select(
      'id, video_version_id, agency_id, user_id, content, comment_type, timestamp_seconds, end_timestamp_seconds, parent_id, resolved, resolved_at, resolved_by, deleted_at, created_at'
    )
    .eq('video_version_id', versionId)
    .is('deleted_at', null)
    .order('timestamp_seconds', { ascending: true })

  if (commentsError) {
    console.error('[comments:GET] DB query failed:', commentsError)
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 })
  }

  return NextResponse.json({ comments: comments ?? [] })
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
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { videoId: string; versionId: string } }
) {
  const { videoId, versionId } = params

  if (!UUID_RE.test(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID format' }, { status: 400 })
  }
  if (!UUID_RE.test(versionId)) {
    return NextResponse.json({ error: 'Invalid version ID format' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('[comments:POST] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options)
        }
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  try {
    const { rateLimit } = await import('@/lib/redis')
    const remaining = await rateLimit(
      `comments:post:user:${user.id}`,
      COMMENTS_POST_RATE_LIMIT,
      COMMENTS_RATE_WINDOW
    )
    if (remaining === -1) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(COMMENTS_RATE_WINDOW) } }
      )
    }
  } catch (err) {
    console.error('[comments:POST] Rate limit check failed, failing-closed:', err)
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(COMMENTS_RATE_WINDOW) } }
    )
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

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
      .select('id, video_version_id, agency_id, deleted_at')
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
    .select()
    .single()

  if (insertError || !comment) {
    console.error('[comments:POST] Insert failed:', insertError)
    return NextResponse.json({ error: 'Failed to create comment' }, { status: 500 })
  }

  return NextResponse.json({ comment }, { status: 201 })
}
