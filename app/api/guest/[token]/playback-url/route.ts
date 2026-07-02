import { createClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getStorage } from '@/lib/storage'
import { hashGuestToken, verifyGuestToken } from '@/lib/guest-tokens'
import { checkRateLimit } from '@/lib/api-helpers'

/**
 * GET /api/guest/:token/playback-url
 *
 * Public endpoint — no Supabase Auth required.
 * Returns a 15-minute signed R2 URL for video playback.
 * Increments view_count and sets last_viewed_at on each successful call.
 *
 * Security:
 * - Token validation identical to /api/guest/:token (timing-safe).
 * - Unknown/expired/revoked → 404 (no enumeration).
 * - r2_key is never returned — only the signed URL.
 * - Rate-limited by hashed token: 20 req/min.
 */
const SIGNED_URL_EXPIRY_SECONDS = 900 // 15 minutes
const GUEST_RATE_LIMIT = 20
const GUEST_RATE_WINDOW = 60

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  const { token } = params

  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const tokenHash = hashGuestToken(token)

  // Rate limit by hashed token
  const rl = await checkRateLimit(
    `guest:${tokenHash}`,
    GUEST_RATE_LIMIT,
    GUEST_RATE_WINDOW,
    'guest:playback-url',
    'Too many requests. Please try again later.'
  )
  if (rl) return rl

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[guest:playback-url] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: link, error: linkError } = await admin
    .from('guest_links')
    .select('id, video_id, video_version_id, token_hash, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (linkError) {
    console.error('[guest:playback-url] DB lookup error:', linkError.message)
  }

  // Unknown / revoked / expired / mismatched hash all collapse to 404 (no enumeration).
  if (
    !link ||
    !verifyGuestToken(token, link.token_hash) ||
    link.revoked_at !== null ||
    (link.expires_at !== null && new Date(link.expires_at) < new Date())
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: video, error: videoError } = await admin
    .from('videos')
    .select('id, active_version_id')
    .eq('id', link.video_id)
    .single()

  if (videoError || !video) {
    console.error('[guest:playback-url] Video lookup failed:', videoError?.message)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Resolve target version: pinned at creation time, or current active
  const targetVersionId = link.video_version_id ?? video.active_version_id

  if (!targetVersionId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: version, error: versionError } = await admin
    .from('video_versions')
    .select('id, r2_key')
    .eq('id', targetVersionId)
    .eq('video_id', video.id)
    .single()

  if (versionError || !version) {
    console.error('[guest:playback-url] Version lookup failed:', versionError?.message)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Generate signed URL — r2_key never returned to caller
  let signedUrl: string
  try {
    signedUrl = await getStorage().generateSignedUrl(version.r2_key, SIGNED_URL_EXPIRY_SECONDS)
  } catch (err) {
    console.error(
      '[guest:playback-url] Failed to generate signed URL:',
      err instanceof Error ? err.message : 'Unknown error'
    )
    return NextResponse.json({ error: 'Failed to generate playback URL' }, { status: 500 })
  }

  // Atomic increment via RPC — prevents lost updates under concurrent playback.
  const { error: rpcError } = await admin.rpc('increment_guest_link_view', { p_id: link.id })
  if (rpcError) {
    console.error('[guest:playback-url] Failed to update view stats:', rpcError.message)
    Sentry.captureException(rpcError)
  }

  return NextResponse.json({
    url: signedUrl,
    expires_in: SIGNED_URL_EXPIRY_SECONDS,
  })
}
