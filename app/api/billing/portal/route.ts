/**
 * POST /api/billing/portal
 *
 * Creates a Stripe Billing Portal session and returns { url } for the caller
 * to redirect to. Owner, or an admin_agent the owner granted billing access to
 * (memberships.can_manage_billing), behind the billing feature flag.
 *
 * A granted admin agent may only view invoices and change the payment method, so
 * their session MUST use a restricted portal configuration (no plan change, no
 * cancel) from STRIPE_PORTAL_CONFIG_DELEGATE. Unset -> 503 (fail closed): Stripe's
 * default portal configuration would expose cancel / plan change.
 *
 * Security:
 * - Billing feature flag must be enabled (404 if not)
 * - Authenticated users only (401)
 * - Caller must hold owner, or admin_agent + can_manage_billing, in that agency (403),
 *   read fresh from memberships on every request (a revoke applies immediately)
 * - Agency must have a stripe_customer_id (400)
 * - Rate-limited: 10 requests / 60s per user
 * - STRIPE_SECRET_KEY never reaches client bundle (server-only)
 */

import 'server-only'

import { createAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { type NextRequest, NextResponse } from 'next/server'
import { isValidUUID } from '@/lib/validation'
import { checkRateLimit } from '@/lib/api-helpers'
import { isBillingEnabled } from '@/lib/feature-flags'
import { getStripe } from '@/lib/stripe'
import { getSiteOrigin } from '@/lib/site-url'
import { requireBillingAccess } from '@/lib/billing-access'

const PORTAL_RATE_LIMIT = 10
const PORTAL_RATE_WINDOW = 60 // seconds

export async function POST(request: NextRequest) {
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: 'Billing is not enabled' }, { status: 404 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Parse body — agencyId identifies which owned agency's portal to open.
  // Required so the portal always targets the same agency the billing page displayed
  // (a user may own multiple agencies; an un-scoped lookup could resolve a different one).
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const agencyId = (body as { agencyId?: unknown } | null)?.agencyId
  if (typeof agencyId !== 'string' || !isValidUUID(agencyId)) {
    return NextResponse.json({ error: 'Valid agencyId is required' }, { status: 400 })
  }

  // Rate limit by user ID
  const rateLimitResponse = await checkRateLimit(
    `billing:portal:${user.id}`,
    PORTAL_RATE_LIMIT,
    PORTAL_RATE_WINDOW,
    'billing/portal',
    'Too many requests'
  )
  if (rateLimitResponse) return rateLimitResponse

  const admin = createAdminClient()

  // Authorize: owner, or admin_agent with billing access, IN THIS specific agency.
  const access = await requireBillingAccess(admin, user.id, agencyId)
  if (access instanceof NextResponse) return access

  // A delegate must get the restricted portal (payment method + invoices only).
  const delegateConfig = process.env.STRIPE_PORTAL_CONFIG_DELEGATE
  if (access.access === 'delegate' && !delegateConfig) {
    console.error('[billing/portal] STRIPE_PORTAL_CONFIG_DELEGATE is not set; refusing delegate')
    return NextResponse.json({ error: 'Billing portal is not available' }, { status: 503 })
  }

  // Load the agency to get stripe_customer_id (two-query pattern — avoids embed shape ambiguity)
  const { data: agency } = await admin
    .from('agencies')
    .select('stripe_customer_id')
    .eq('id', agencyId)
    .single()

  if (!agency || !agency.stripe_customer_id) {
    return NextResponse.json(
      { error: 'No Stripe customer found — upgrade to a paid plan first' },
      { status: 400 }
    )
  }

  // getSiteOrigin resolves NEXT_PUBLIC_SITE_URL → VERCEL_URL → localhost, so the
  // Stripe return URL is correct on preview/prod without a hardcoded localhost fallback.
  const returnUrl = `${getSiteOrigin(request)}/settings/billing`

  try {
    const stripe = getStripe()
    const session = await stripe.billingPortal.sessions.create({
      customer: agency.stripe_customer_id as string,
      return_url: returnUrl,
      ...(access.access === 'delegate' ? { configuration: delegateConfig } : {}),
    })
    return NextResponse.json({ url: session.url }, { status: 200 })
  } catch (err) {
    console.error('[billing/portal] Stripe error:', err)
    return NextResponse.json({ error: 'Failed to create billing portal session' }, { status: 500 })
  }
}
