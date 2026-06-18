/**
 * POST /api/agencies/[id]/dpa-accept
 *
 * Records the agency owner's acceptance of the Data Processing Agreement (BILLING-006).
 * Writes dpa_accepted_at = now() and dpa_accepted_ip to the agencies row.
 *
 * Security:
 * - Billing feature flag must be enabled (404 if not)
 * - Authenticated users only (401)
 * - Caller must hold the 'owner' role in the target agency (403)
 * - Rate-limited: 10 requests / 60s per agency
 */

import 'server-only'

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { isValidUUID } from '@/lib/validation'
import { checkRateLimit } from '@/lib/api-helpers'
import { isBillingEnabled } from '@/lib/feature-flags'

const DPA_RATE_LIMIT = 10
const DPA_RATE_WINDOW = 60 // seconds

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  // Feature flag gate
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: 'Billing is not enabled' }, { status: 404 })
  }

  const agencyId = params.id

  if (!isValidUUID(agencyId)) {
    return NextResponse.json({ error: 'Invalid agency ID' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('[agencies/[id]/dpa-accept:POST] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  // ---- User auth (cookie-scoped client) ------------------------------------
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

  // ---- Admin client (service-role, bypasses RLS) ---------------------------
  const admin = createClient(supabaseUrl, serviceRoleKey)

  // ---- Caller authz: must be owner in this agency --------------------------
  // Distinguish a DB error (→500) from "no membership row" (PGRST116 → 403).
  const { data: callerMembership, error: membershipError } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('agency_id', agencyId)
    .single()

  if (membershipError && membershipError.code !== 'PGRST116') {
    console.error('[agencies/[id]/dpa-accept:POST] Membership lookup failed:', membershipError)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }

  if (!callerMembership || callerMembership.role !== 'owner') {
    return NextResponse.json({ error: 'Access denied — owner role required' }, { status: 403 })
  }

  // ---- Rate limit (after authz — non-owners can't burn the shared key) -----
  const rateLimitResponse = await checkRateLimit(
    `dpa-accept:post:agency:${agencyId}`,
    DPA_RATE_LIMIT,
    DPA_RATE_WINDOW,
    'agencies/[id]/dpa-accept:POST',
    'Too many requests'
  )
  if (rateLimitResponse) return rateLimitResponse

  // ---- Derive client IP from headers ----
  // On Vercel the original client IP is `x-real-ip` (single, unambiguous) and is
  // the FIRST entry of `x-forwarded-for`; the rightmost XFF entry is Vercel's own
  // proxy. For the DPA audit trail we want the owner's IP, so prefer x-real-ip,
  // then the leftmost XFF entry.
  const clientIp =
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'

  // ---- Write DPA acceptance -------------------------------------------------
  const { error: updateError } = await admin
    .from('agencies')
    .update({
      dpa_accepted_at: new Date().toISOString(),
      dpa_accepted_ip: clientIp,
    })
    .eq('id', agencyId)

  if (updateError) {
    console.error('[agencies/[id]/dpa-accept:POST] Failed to record DPA acceptance:', updateError)
    return NextResponse.json({ error: 'Failed to record DPA acceptance' }, { status: 500 })
  }

  return NextResponse.json({ accepted: true }, { status: 200 })
}
