import { verifyGuestToken } from '@/lib/guest-tokens'
import { createAdminClient } from '@/lib/supabase-admin'
import { agencyAllowsGuestLinks } from '@/lib/guest/agency-entitlement'

/**
 * GuestMetadata — shape returned to callers (page + API route).
 * Never includes r2_key, agency_id, token_hash, or any internal pivot field.
 * Guests see the video only: no comment data is queried or returned (flow decision, GH #165).
 */
export type GuestMetadata = {
  video: {
    id: string
    title: string
  }
  version: {
    id: string
    version_number: number
    duration_seconds: number | null
  } | null
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
 *   5. Fetches the version row (never comments).
 *
 * Returns null for any rejection case (unknown token, expired, revoked,
 * missing video) so the caller can render 404 / redirect without leaking
 * enumeration information.
 */
export type GuestLinkRejection = 'expired' | 'revoked' | 'subscription' | 'not-found'

export type GuestLinkResult =
  | { ok: true; data: GuestMetadata }
  | { ok: false; reason: GuestLinkRejection }

export async function getGuestMetadata(token: string): Promise<GuestMetadata | null> {
  const result = await resolveGuestLink(token)
  return result.ok ? result.data : null
}

/**
 * Same pipeline as getGuestMetadata, but says why a link was rejected. Only the
 * /guest/[token] page uses it (to pick a generic heading on /guest/invalid); the
 * API route keeps collapsing every rejection to one response.
 */
export async function resolveGuestLink(token: string): Promise<GuestLinkResult> {
  const notFound: GuestLinkResult = { ok: false, reason: 'not-found' }
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (err) {
    console.error('[guest:metadata] Missing Supabase environment variables', err)
    return notFound
  }

  // Import here so this module works in both API-route and RSC contexts
  const { hashGuestToken } = await import('@/lib/guest-tokens')
  const tokenHash = hashGuestToken(token)

  const { data: link, error: linkError } = await admin
    .from('guest_links')
    .select('id, video_id, agency_id, video_version_id, token_hash, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (linkError) {
    console.error('[guest:metadata] DB lookup error:', linkError.message)
  }

  // Unknown / failed lookup / revoked / expired all collapse to null (no enumeration).
  // verifyGuestToken is timing-safe defense-in-depth even though hash equality is sufficient.
  if (!link || !verifyGuestToken(token, link.token_hash)) return notFound
  if (link.revoked_at !== null) return { ok: false, reason: 'revoked' }
  if (link.expires_at !== null && new Date(link.expires_at) < new Date()) {
    return { ok: false, reason: 'expired' }
  }

  // Ended subscription: its own generic heading on /guest/invalid (no billing details).
  if (!(await agencyAllowsGuestLinks(admin, link.agency_id))) {
    return { ok: false, reason: 'subscription' }
  }

  // Fetch video metadata — never return r2_key, agency_id, or internal ids that allow pivoting
  const { data: video, error: videoError } = await admin
    .from('videos')
    .select('id, title, active_version_id')
    .eq('id', link.video_id)
    .single()

  if (videoError || !video) {
    console.error('[guest:metadata] Video lookup failed:', videoError?.message)
    return notFound
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

  return {
    ok: true,
    data: {
      video: {
        id: video.id,
        title: video.title,
      },
      version: version
        ? {
            id: version.id,
            version_number: version.version_number,
            duration_seconds: version.duration_seconds,
          }
        : null,
    },
  }
}
