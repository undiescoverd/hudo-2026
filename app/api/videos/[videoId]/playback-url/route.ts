import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { getStorage } from '@/lib/storage'

const SIGNED_URL_EXPIRY_SECONDS = 900 // 15 minutes

/**
 * GET /api/videos/:videoId/playback-url
 *
 * Returns a pre-signed R2 URL for video playback.
 *
 * Security:
 * - Authenticated users only (401 for unauthenticated)
 * - User must have a membership in the same agency as the video (403 otherwise)
 * - Direct R2 object URLs are never returned — only signed URLs
 * - Signed URL expires after 15 minutes
 */
export async function GET(_request: NextRequest, { params }: { params: { videoId: string } }) {
  const { videoId } = params

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('[playback-url] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  // Authenticate the requesting user via session cookie
  const cookieStore = await cookies()
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Use service role to bypass RLS for the access check query
  const admin = createClient(supabaseUrl, serviceRoleKey)

  // Fetch the video and check that the requesting user has a membership
  // in the same agency as the video.
  const { data: video, error: videoError } = await admin
    .from('videos')
    .select('id, agency_id')
    .eq('id', videoId)
    .single()

  if (videoError || !video) {
    // Video does not exist — return 403 to avoid leaking existence to
    // users who have no access to the resource.
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Verify user has a membership in the video's agency
  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('agency_id', video.agency_id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Fetch the latest video version's R2 key (column is `r2_key` per migration 0001)
  const { data: version, error: versionError } = await admin
    .from('video_versions')
    .select('r2_key')
    .eq('video_id', videoId)
    .order('version_number', { ascending: false })
    .limit(1)
    .single()

  if (versionError || !version) {
    return NextResponse.json({ error: 'No video version found' }, { status: 404 })
  }

  // Generate the signed URL — the only URL type ever returned to clients
  let signedUrl: string
  try {
    signedUrl = await getStorage().generateSignedUrl(version.r2_key, SIGNED_URL_EXPIRY_SECONDS)
  } catch (err) {
    console.error(
      '[playback-url] Failed to generate signed URL:',
      err instanceof Error ? err.message : 'Unknown error'
    )
    return NextResponse.json({ error: 'Failed to generate playback URL' }, { status: 500 })
  }

  return NextResponse.json({
    url: signedUrl,
    expiresIn: SIGNED_URL_EXPIRY_SECONDS,
  })
}
