/**
 * GET /api/videos/:videoId/versions/:versionId/comments/export
 *
 * Returns a PDF containing all non-deleted comments for the given video version.
 *
 * Security:
 * - Authenticated users only (401)
 * - User must be a member of the video's agency (enforced via requireMembership)
 * - Talent can only export their own videos; agents/admins/owners can export any
 *   video in their agency (403 otherwise)
 * - Rate-limited per user
 */

import { createClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { checkRateLimit, requireMembership } from '@/lib/api-helpers'
import { isValidUUID } from '@/lib/validation'
import { buildCommentExportPdf, canExport, type CommentRow } from '@/lib/pdf-export'

const EXPORT_RATE_LIMIT = 10 // max requests per window per user
const EXPORT_RATE_WINDOW = 60 // 1 minute

export async function GET(
  _request: NextRequest,
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
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('[comments/export:GET] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  // Authenticate
  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Rate limit
  const rl = await checkRateLimit(
    `comments:export:user:${user.id}`,
    EXPORT_RATE_LIMIT,
    EXPORT_RATE_WINDOW,
    'comments/export',
    'Too many requests. Please try again later.'
  )
  if (rl) return rl

  const admin = createClient(supabaseUrl, serviceRoleKey)

  // Fetch video
  const { data: video, error: videoError } = await admin
    .from('videos')
    .select('id, title, agency_id, talent_id')
    .eq('id', videoId)
    .single()

  if (videoError || !video) {
    // Return 403 so as not to reveal existence of the video
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Membership check — 403 if user is not a member of this agency
  const membership = await requireMembership(admin, user.id, video.agency_id)
  if (membership instanceof NextResponse) return membership

  // Authorization: talent may only export their own video
  if (!canExport({ role: membership.role, videoTalentId: video.talent_id, userId: user.id })) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Fetch video version (also validates version belongs to this video)
  const { data: version, error: versionError } = await admin
    .from('video_versions')
    .select('id, version_number')
    .eq('id', versionId)
    .eq('video_id', videoId)
    .single()

  if (versionError || !version) {
    return NextResponse.json({ error: 'Version not found' }, { status: 404 })
  }

  // Fetch non-deleted comments for this version
  const { data: rawComments, error: commentsError } = await admin
    .from('comments')
    .select('id, user_id, content, timestamp_seconds, resolved')
    .eq('video_version_id', versionId)
    .is('deleted_at', null)
    .order('timestamp_seconds', { ascending: true })

  if (commentsError) {
    console.error('[comments/export:GET] Failed to fetch comments:', commentsError)
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 })
  }

  const comments = rawComments ?? []

  // Resolve commenter names — batch fetch to avoid N+1
  const userIds = [...new Set(comments.map((c) => c.user_id).filter(Boolean))]
  const nameMap = new Map<string, string>()

  if (userIds.length > 0) {
    const { data: users } = await admin.from('users').select('id, full_name').in('id', userIds)

    for (const u of users ?? []) {
      nameMap.set(u.id, u.full_name ?? 'Unknown')
    }
  }

  // Also look up the requesting user's display name for the generator field
  const { data: generatorUser } = await admin
    .from('users')
    .select('full_name')
    .eq('id', user.id)
    .single()

  const generatorName = generatorUser?.full_name ?? user.email ?? 'Unknown'

  // Build comment rows
  const commentRows: CommentRow[] = comments.map((c) => ({
    id: c.id,
    timestamp_seconds: c.timestamp_seconds,
    commenter_name: nameMap.get(c.user_id) ?? 'Unknown',
    content: c.content ?? '',
    resolved: c.resolved ?? false,
  }))

  // Generate PDF
  let bytes: Uint8Array
  try {
    bytes = await buildCommentExportPdf({
      videoTitle: video.title,
      versionNumber: version.version_number,
      exportDate: new Date(),
      generatorName,
      comments: commentRows,
    })
  } catch (err) {
    console.error('[comments/export:GET] PDF generation failed:', err)
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 })
  }

  // Sanitize title for use in Content-Disposition filename (strip non-ASCII and unsafe chars)
  const safeTitle = video.title
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60)

  const filename = `comments-${safeTitle}-v${version.version_number}.pdf`

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
