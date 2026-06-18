/**
 * POST /api/billing/portal
 *
 * Creates a Stripe Billing Portal session and returns { url } for the caller
 * to redirect to. Owner-only, behind the billing feature flag.
 *
 * Security:
 * - Billing feature flag must be enabled (404 if not)
 * - Authenticated users only (401)
 * - Caller must hold 'owner' role in an agency with a stripe_customer_id (403/400)
 * - Rate-limited: 10 requests / 60s per user
 * - STRIPE_SECRET_KEY never reaches client bundle (server-only)
 */

import 'server-only'

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { isValidUUID } from '@/lib/validation'
import { checkRateLimit } from '@/lib/api-helpers'
import { isBillingEnabled } from '@/lib/feature-flags'
import { getStripe } from '@/lib/stripe'

const PORTAL_RATE_LIMIT = 10
const PORTAL_RATE_WINDOW = 60 // seconds

export async function POST(request: NextRequest) {
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: 'Billing is not enabled' }, { status: 404 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
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

  const admin = createClient(supabaseUrl, serviceRoleKey)

  // Authorize: caller must hold the owner role IN THIS specific agency.
  const { data: ownerMembership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('agency_id', agencyId)
    .eq('role', 'owner')
    .maybeSingle()

  if (!ownerMembership) {
    return NextResponse.json({ error: 'Access denied — owner role required' }, { status: 403 })
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const returnUrl = `${appUrl}/settings/billing`

  try {
    const stripe = getStripe()
    const session = await stripe.billingPortal.sessions.create({
      customer: agency.stripe_customer_id as string,
      return_url: returnUrl,
    })
    return NextResponse.json({ url: session.url }, { status: 200 })
  } catch (err) {
    console.error('[billing/portal] Stripe error:', err)
    return NextResponse.json({ error: 'Failed to create billing portal session' }, { status: 500 })
  }
}
