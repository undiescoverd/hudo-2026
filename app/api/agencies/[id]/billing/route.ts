/**
 * PATCH /api/agencies/[id]/billing  — persist legal entity data
 * POST  /api/agencies/[id]/billing  — create Stripe Checkout Session
 *
 * PATCH (BILLING-004):
 *   Saves legal_name, billing_address (jsonb), vat_number to the agencies row.
 *   Owner-only.
 *
 * POST (BILLING-004 + BILLING-006 convergence):
 *   Validates legal entity data + DPA acceptance are present in the DB (not just
 *   the request body — prevents client-side bypass), then creates a Stripe
 *   Checkout Session. Returns { url } for the caller to redirect to.
 *   Owner-only. Applies FOUNDING_50 coupon for founding members.
 *
 * Security:
 * - Billing feature flag must be enabled (404 if not)
 * - Authenticated users only (401)
 * - Caller must hold 'owner' role in the target agency (403)
 * - Rate-limited: 20 requests / 60s per agency
 * - metadata.agency_id REQUIRED on checkout session (webhook convergence)
 * - STRIPE_SECRET_KEY never reaches client bundle
 */

import 'server-only'

import { createAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { type NextRequest, NextResponse } from 'next/server'
import { isValidUUID } from '@/lib/validation'
import { checkRateLimit } from '@/lib/api-helpers'
import { isBillingEnabled } from '@/lib/feature-flags'
import { getStripe, resolvePriceId, getCheckoutLookupKey, FOUNDING_COUPON } from '@/lib/stripe'
import { logEvent } from '@/lib/audit'
import {
  validateCheckoutPreconditions,
  buildCheckoutSessionParams,
  isPaidPlan,
  type AgencyCheckoutData,
} from '@/lib/billing-checkout'

const BILLING_RATE_LIMIT = 20
const BILLING_RATE_WINDOW = 60 // seconds

// ---------------------------------------------------------------------------
// Shared setup: auth, rate limit, admin client, membership check
// ---------------------------------------------------------------------------

async function getAuthedOwner(request: NextRequest, agencyId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: NextResponse.json({ error: 'Server configuration error' }, { status: 500 }) }
  }

  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) }
  }

  const admin = createAdminClient()

  // Owner-only check. Distinguish a genuine DB error (→500) from "no membership
  // row" (PGRST116 → 403) so an outage isn't masked as an auth failure.
  const { data: callerMembership, error: membershipError } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('agency_id', agencyId)
    .single()

  if (membershipError && membershipError.code !== 'PGRST116') {
    console.error('[agencies/[id]/billing] Membership lookup failed:', membershipError)
    return { error: NextResponse.json({ error: 'Server error' }, { status: 500 }) }
  }

  if (!callerMembership || callerMembership.role !== 'owner') {
    return {
      error: NextResponse.json({ error: 'Access denied — owner role required' }, { status: 403 }),
    }
  }

  // Rate limit by agency — AFTER authorization, so a non-owner who knows an
  // agency ID can't burn another agency's shared billing limit (429 DoS).
  const rateLimitResponse = await checkRateLimit(
    `billing:agency:${agencyId}`,
    BILLING_RATE_LIMIT,
    BILLING_RATE_WINDOW,
    'agencies/[id]/billing',
    'Too many requests'
  )
  if (rateLimitResponse) return { error: rateLimitResponse }

  return { user, admin }
}

// ---------------------------------------------------------------------------
// PATCH — persist legal entity data
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: 'Billing is not enabled' }, { status: 404 })
  }

  const agencyId = params.id
  if (!isValidUUID(agencyId)) {
    return NextResponse.json({ error: 'Invalid agency ID' }, { status: 400 })
  }

  const auth = await getAuthedOwner(request, agencyId)
  if ('error' in auth) return auth.error
  const { admin } = auth

  // Parse body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 })
  }

  const b = body as Record<string, unknown>

  if (typeof b.legal_name !== 'string' || b.legal_name.trim() === '') {
    return NextResponse.json({ error: 'legal_name is required' }, { status: 400 })
  }

  // Validate the address schema (not just "non-empty object") so we don't persist
  // arbitrary junk that still satisfies downstream non-empty checks. Required
  // fields mirror LegalEntityForm's isAddressFilled: line1, city, postal_code.
  if (
    !b.billing_address ||
    typeof b.billing_address !== 'object' ||
    Array.isArray(b.billing_address)
  ) {
    return NextResponse.json({ error: 'billing_address must be an object' }, { status: 400 })
  }
  const addr = b.billing_address as Record<string, unknown>
  const requiredAddressFields = ['line1', 'city', 'postal_code'] as const
  for (const field of requiredAddressFields) {
    if (typeof addr[field] !== 'string' || (addr[field] as string).trim() === '') {
      return NextResponse.json({ error: `billing_address.${field} is required` }, { status: 400 })
    }
  }

  const updatePayload: Record<string, unknown> = {
    legal_name: b.legal_name.trim(),
    billing_address: b.billing_address,
  }

  if (typeof b.vat_number === 'string' && b.vat_number.trim()) {
    updatePayload.vat_number = b.vat_number.trim()
  } else if ('vat_number' in b) {
    // Explicit null/empty clears the field
    updatePayload.vat_number = null
  }

  const { error: updateError } = await admin
    .from('agencies')
    .update(updatePayload)
    .eq('id', agencyId)

  if (updateError) {
    console.error('[agencies/[id]/billing:PATCH] Failed to update legal entity data:', updateError)
    return NextResponse.json({ error: 'Failed to save billing details' }, { status: 500 })
  }

  return NextResponse.json({ saved: true }, { status: 200 })
}

// ---------------------------------------------------------------------------
// POST — create Stripe Checkout Session
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: 'Billing is not enabled' }, { status: 404 })
  }

  const agencyId = params.id
  if (!isValidUUID(agencyId)) {
    return NextResponse.json({ error: 'Invalid agency ID' }, { status: 400 })
  }

  const auth = await getAuthedOwner(request, agencyId)
  if ('error' in auth) return auth.error
  const { user, admin } = auth

  // Parse body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 })
  }

  const b = body as Record<string, unknown>

  if (typeof b.plan !== 'string' || !isPaidPlan(b.plan)) {
    return NextResponse.json(
      { error: 'plan must be one of: starter, studio, agency_pro' },
      { status: 400 }
    )
  }

  const plan = b.plan

  if (b.interval !== undefined && b.interval !== 'month' && b.interval !== 'year') {
    return NextResponse.json({ error: 'interval must be month or year' }, { status: 400 })
  }
  const interval = b.interval === 'year' ? 'year' : 'month'

  // ---- Fetch agency from DB (validate preconditions against DB, not request body) ----
  const { data: agency, error: agencyError } = await admin
    .from('agencies')
    .select(
      'id, legal_name, billing_address, dpa_accepted_at, is_founding_member, stripe_customer_id'
    )
    .eq('id', agencyId)
    .single()

  if (agencyError || !agency) {
    console.error('[agencies/[id]/billing:POST] Failed to fetch agency:', agencyError)
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
  }

  // ---- Gate: legal entity + DPA acceptance (BILLING-004 + BILLING-006) ----
  const validation = validateCheckoutPreconditions(agency as AgencyCheckoutData)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status })
  }

  // ---- Build success/cancel URLs -------------------------------------------
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const successUrl = `${appUrl}/settings/billing?checkout=success`
  const cancelUrl = `${appUrl}/settings/billing?checkout=canceled`

  // ---- Create Stripe Checkout Session --------------------------------------
  let sessionUrl: string
  try {
    const stripe = getStripe()
    const agencyData = agency as AgencyCheckoutData
    const priceId = await resolvePriceId(getCheckoutLookupKey(plan, interval))
    const sessionParams = buildCheckoutSessionParams(agencyData, plan, {
      successUrl,
      cancelUrl,
      priceId,
      coupon: agencyData.is_founding_member ? FOUNDING_COUPON : null,
    })
    const session = await stripe.checkout.sessions.create(sessionParams)
    if (!session.url) {
      console.error('[agencies/[id]/billing:POST] Stripe session created but no URL returned')
      return NextResponse.json({ error: 'Checkout session creation failed' }, { status: 500 })
    }
    sessionUrl = session.url
  } catch (err) {
    console.error('[agencies/[id]/billing:POST] Stripe error:', err)
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 })
  }

  // ---- Audit log (fire-and-forget) -----------------------------------------
  const actorName =
    typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()
      ? user.user_metadata.full_name.trim()
      : (user.email ?? user.id)

  logEvent({
    action: 'billing_plan_changed',
    resourceType: 'billing',
    resourceId: agencyId,
    agencyId,
    actorId: user.id,
    actorName,
    metadata: { plan, interval, checkout: 'initiated' },
  }).catch((err) =>
    console.error('[agencies/[id]/billing:POST] logEvent unhandled rejection:', err)
  )

  return NextResponse.json({ url: sessionUrl }, { status: 200 })
}
