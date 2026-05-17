import { type NextRequest, NextResponse } from 'next/server'
import { hashGuestToken } from '@/lib/guest-tokens'
import { checkRateLimit } from '@/lib/api-helpers'
import { getGuestMetadata } from '@/lib/guest/get-guest-metadata'

/**
 * GET /api/guest/:token
 *
 * Public endpoint — no Supabase Auth required.
 * Validates the plaintext token against the stored SHA-256 hash.
 * Returns video metadata + comments for the current version.
 *
 * Security:
 * - Token comparison is timing-safe (via verifyGuestToken in getGuestMetadata).
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

  const metadata = await getGuestMetadata(token)

  if (!metadata) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(metadata)
}
