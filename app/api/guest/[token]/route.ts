import { createClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { hashGuestToken, verifyGuestToken } from '@/lib/guest-tokens'
import { checkRateLimit } from '@/lib/api-helpers'

/**
 * GET /api/guest/:token
 *
 * Public endpoint — no Supabase Auth required.
 * Validates the plaintext token against the stored SHA-256 hash.
 * Returns video metadata + comments for the current version.
 *
 * Security:
 * - Token comparison is timing-safe (via verifyGuestToken).
 * - Unknown/expired/revoked tokens all return HTTP 404 (no enumeration leakage).
 * - Uses service-role Supabase client to bypass RLS for the explicit read.
 * - Never returns r2_key, agency_id, or the token hash to the caller.
 * - Rate-limited by hashed token: 20 req/min.
 */
const GUEST_RATE_LIMIT = 20
const GUEST_RATE_WINDOW = 60

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  const { token } = params

  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const tokenHash = hashGuestToken(token)

  // Rate limit by hashed token — plaintext never used as cache key
  const rl = await checkRateLimit(
    `guest:${tokenHash}`,
    GUEST_RATE_LIMIT,
    GUEST_RATE_WINDOW,
    'guest:metadata',
    'Too many requests. Please try again later.'
  )
  if (rl) return rl

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[guest:metadata] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: link, error: linkError } = await admin
    .from('guest_links')
    .select('id, video_id, video_version_id, token_hash, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (linkError) {
    console.error('[guest:metadata] DB lookup error:', linkError.message)
  }

  // Unknown / failed lookup / revoked / expired all collapse to 404 (no enumeration).
  // verifyGuestToken is timing-safe defense-in-depth even though hash equality is sufficient.
  if (
    !link ||
    !verifyGuestToken(token, link.token_hash) ||
    link.revoked_at !== null ||
    (link.expires_at !== null && new Date(link.expires_at) < new Date())
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Fetch video metadata — never return r2_key, agency_id, or internal ids that allow pivoting
  const { data: video, error: videoError } = await admin
    .from('videos')
    .select('id, title, description, status, active_version_id')
    .eq('id', link.video_id)
    .single()

  if (videoError || !video) {
    console.error('[guest:metadata] Video lookup failed:', videoError?.message)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Resolve which version to serve: pinned at link creation time, or current active
  const targetVersionId = link.video_version_id ?? video.active_version_id

  let version: { id: string; version_number: number; duration_seconds: number | null } | null = null

  if (targetVersionId) {
    const { data: v } = await admin
      .from('video_versions')
      .select('id, version_number, duration_seconds')
      .eq('id', targetVersionId)
      .eq('video_id', video.id)
      .single()
    if (v) version = v
  }

  type GuestComment = {
    id: string
    content: string
    timestamp_seconds: number | null
    created_at: string
    display_name: string | null
  }
  let comments: GuestComment[] = []

  if (version) {
    const { data: rawComments } = await admin
      .from('comments')
      .select('id, content, timestamp_seconds, created_at, users!comments_user_id_fkey(full_name)')
      .eq('video_version_id', version.id)
      .is('deleted_at', null)
      .order('timestamp_seconds', { ascending: true })

    comments = (rawComments ?? []).map((c) => {
      const userRel = c.users
      const displayName =
        userRel && typeof userRel === 'object' && !Array.isArray(userRel)
          ? ((userRel as { full_name: string }).full_name ?? null)
          : null
      return {
        id: c.id,
        content: c.content,
        timestamp_seconds: c.timestamp_seconds != null ? Number(c.timestamp_seconds) : null,
        created_at: c.created_at,
        display_name: displayName,
      }
    })
  }

  return NextResponse.json({
    video: {
      id: video.id,
      title: video.title,
      description: video.description,
      status: video.status,
    },
    version: version
      ? {
          id: version.id,
          version_number: version.version_number,
          duration_seconds: version.duration_seconds,
        }
      : null,
    comments,
  })
}
