import { verifyGuestToken } from '@/lib/guest-tokens'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * GuestMetadata — shape returned to callers (page + API route).
 * Never includes r2_key, agency_id, token_hash, or any internal pivot field.
 */
export type GuestComment = {
  id: string
  content: string
  timestamp_seconds: number | null
  created_at: string
  display_name: string | null
}

export type GuestMetadata = {
  video: {
    id: string
    title: string
    description: string | null
    status: string
  }
  version: {
    id: string
    version_number: number
    duration_seconds: number | null
  } | null
  comments: GuestComment[]
}

/**
 * getGuestMetadata — server-only helper (no HTTP, no host-header risk).
 *
 * Performs the full guest-link validation pipeline using a service-role
 * Supabase client so RLS is bypassed for these explicit, validated reads:
 *   1. Looks up the guest_links row by SHA-256 token hash.
 *   2. Timing-safe verifyGuestToken comparison (defense-in-depth).
 *   3. Revocation + expiry checks.
 *   4. Fetches video metadata (no r2_key / agency_id).
 *   5. Fetches version + non-deleted comments.
 *
 * Returns null for any rejection case (unknown token, expired, revoked,
 * missing video) so the caller can render 404 / redirect without leaking
 * enumeration information.
 */
export async function getGuestMetadata(token: string): Promise<GuestMetadata | null> {
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (err) {
    console.error('[guest:metadata] Missing Supabase environment variables', err)
    return null
  }

  // Import here so this module works in both API-route and RSC contexts
  const { hashGuestToken } = await import('@/lib/guest-tokens')
  const tokenHash = hashGuestToken(token)

  const { data: link, error: linkError } = await admin
    .from('guest_links')
    .select('id, video_id, video_version_id, token_hash, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (linkError) {
    console.error('[guest:metadata] DB lookup error:', linkError.message)
  }

  // Unknown / failed lookup / revoked / expired all collapse to null (no enumeration).
  // verifyGuestToken is timing-safe defense-in-depth even though hash equality is sufficient.
  if (
    !link ||
    !verifyGuestToken(token, link.token_hash) ||
    link.revoked_at !== null ||
    (link.expires_at !== null && new Date(link.expires_at) < new Date())
  ) {
    return null
  }

  // Fetch video metadata — never return r2_key, agency_id, or internal ids that allow pivoting
  const { data: video, error: videoError } = await admin
    .from('videos')
    .select('id, title, description, status, active_version_id')
    .eq('id', link.video_id)
    .single()

  if (videoError || !video) {
    console.error('[guest:metadata] Video lookup failed:', videoError?.message)
    return null
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

  type RawComment = {
    id: string
    content: string
    timestamp_seconds: number | null
    created_at: string
    users: { full_name: string } | { full_name: string }[] | null
  }
  let comments: GuestComment[] = []

  if (version) {
    const { data: rawComments } = await admin
      .from('comments')
      .select('id, content, timestamp_seconds, created_at, users!comments_user_id_fkey(full_name)')
      .eq('video_version_id', version.id)
      .is('deleted_at', null)
      .order('timestamp_seconds', { ascending: true })

    comments = ((rawComments ?? []) as RawComment[]).map((c) => {
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

  return {
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
  }
}
