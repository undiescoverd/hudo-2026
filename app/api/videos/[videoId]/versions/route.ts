import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/videos/:videoId/versions
 *
 * Returns all versions for a video, ordered by version number descending.
 * No R2 keys are exposed — only metadata.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_request: NextRequest, { params }: { params: { videoId: string } }) {
  const { videoId } = params

  if (!UUID_RE.test(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID format' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('[versions] Missing Supabase environment variables')
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

  const admin = createClient(supabaseUrl, serviceRoleKey)

  // Fetch video and verify agency membership
  const { data: video, error: videoError } = await admin
    .from('videos')
    .select('id, agency_id')
    .eq('id', videoId)
    .single()

  if (videoError || !video) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('agency_id', video.agency_id)
    .single()

  if (!membership) {
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
