import { createClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { checkRateLimit, requireMembership } from '@/lib/api-helpers'
import { isValidUUID } from '@/lib/validation'

/**
 * GET /api/videos/:videoId/versions
 *
 * Returns all versions for a video, ordered by version number descending.
 * No R2 keys are exposed — only metadata.
 */
const VERSIONS_RATE_LIMIT = 60 // max requests per window
const VERSIONS_RATE_WINDOW = 60 // 1 minute in seconds

export async function GET(_request: NextRequest, { params }: { params: { videoId: string } }) {
  const { videoId } = params

  if (!isValidUUID(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID format' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('[versions] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Rate limit: 60 version list requests per user per minute
  const rl = await checkRateLimit(
    `versions:get:user:${user.id}`,
    VERSIONS_RATE_LIMIT,
    VERSIONS_RATE_WINDOW,
    'versions',
    'Too many requests. Please try again later.'
  )
  if (rl) return rl

  const admin = createClient(supabaseUrl, serviceRoleKey)

  // Fetch video and verify agency membership
  const { data: video, error: videoError } = await admin
    .from('videos')
    .select('id, agency_id, talent_id')
    .eq('id', videoId)
    .single()

  if (videoError || !video) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const membership = await requireMembership(admin, user.id, video.agency_id)
  if (membership instanceof NextResponse) return membership

  // Enforce talent visibility: talent users can only see their own videos
  if (membership.role === 'talent' && video.talent_id !== user.id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Fetch all versions — no R2 keys exposed
  const { data: versions, error: versionsError } = await admin
    .from('video_versions')
    .select('id, version_number, file_size_bytes, uploaded_by, created_at')
    .eq('video_id', videoId)
    .order('version_number', { ascending: false })

  if (versionsError) {
    console.error('[versions] Failed to fetch versions:', versionsError.message)
    return NextResponse.json({ error: 'Failed to fetch versions' }, { status: 500 })
  }

  return NextResponse.json({
    versions: (versions ?? []).map((v) => ({
      id: v.id,
      versionNumber: v.version_number,
      fileSizeBytes: v.file_size_bytes,
      uploadedBy: v.uploaded_by,
      createdAt: v.created_at,
    })),
  })
}
