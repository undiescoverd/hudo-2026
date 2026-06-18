/**
 * lib/billing-checkout.ts
 *
 * Pure validation and parameter-building helpers for the billing checkout flow.
 * No Next.js imports, no server-only — safe to import in unit tests directly.
 *
 * Responsibilities:
 *   - validateCheckoutPreconditions: verify agency has legal entity data + DPA accepted
 *   - buildCheckoutSessionParams: assemble Stripe session.create() params
 */

import type Stripe from 'stripe'
import type { StripePlan } from '@/lib/stripe'

// ---------------------------------------------------------------------------
// Paid plans only — freemium cannot be checked out.
// ---------------------------------------------------------------------------

export type PaidPlan = Exclude<StripePlan, 'freemium'>
export const PAID_PLANS: ReadonlySet<string> = new Set<PaidPlan>([
  'starter',
  'studio',
  'agency_pro',
])

export function isPaidPlan(plan: string): plan is PaidPlan {
  return PAID_PLANS.has(plan)
}

// ---------------------------------------------------------------------------
// Shape of the agency columns we need — avoids importing the full DB type.
// ---------------------------------------------------------------------------

export interface AgencyCheckoutData {
  id: string
  legal_name: string | null
  billing_address: Record<string, unknown> | null
  dpa_accepted_at: string | null
  is_founding_member: boolean
  stripe_customer_id?: string | null
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidationResult = { ok: true } | { ok: false; error: string; status: 400 | 422 }

/**
 * Validates checkout preconditions (BILLING-004 + BILLING-006).
 *
 * Pure function — no side effects, no I/O.
 * Returns { ok: true } or { ok: false, error, status } for caller to surface.
 */
export function validateCheckoutPreconditions(agency: AgencyCheckoutData): ValidationResult {
  if (!agency.legal_name || agency.legal_name.trim() === '') {
    return {
      ok: false,
      error: 'legal_name is required before checkout',
      status: 422,
    }
  }

  if (
    !agency.billing_address ||
    typeof agency.billing_address !== 'object' ||
    Array.isArray(agency.billing_address) ||
    Object.keys(agency.billing_address).length === 0
  ) {
    return {
      ok: false,
      error: 'billing_address is required before checkout',
      status: 422,
    }
  }

  if (!agency.dpa_accepted_at) {
    return {
      ok: false,
      error: 'Data Processing Agreement must be accepted before checkout',
      status: 422,
    }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Checkout session params
// ---------------------------------------------------------------------------

export interface CheckoutUrlConfig {
  successUrl: string
  cancelUrl: string
  /** Resolved Stripe price ID for the plan (caller resolves via lib/stripe to keep this module server-only-free). */
  priceId: string
  /** Coupon to apply (e.g. FOUNDING_50 for founding members), or null for none. */
  coupon: string | null
}

/**
 * Builds the params object for stripe.checkout.sessions.create().
 *
 * Pure function — no Stripe API calls, no `lib/stripe` value imports, no side effects.
 * The caller resolves the price ID + coupon (which read env / secret-keyed config)
 * and passes them in, so this module stays importable in plain unit tests.
 *   - metadata.agency_id REQUIRED (webhook handler resolves agency via this field)
 *   - Applies the passed coupon when provided
 *   - Re-uses existing stripe_customer_id when present to avoid duplicate customers
 */
export function buildCheckoutSessionParams(
  agency: AgencyCheckoutData,
  plan: PaidPlan,
  urls: CheckoutUrlConfig
): Stripe.Checkout.SessionCreateParams {
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    line_items: [
      {
        price: urls.priceId,
        quantity: 1,
      },
    ],
    metadata: {
      agency_id: agency.id,
      plan,
    },
    success_url: urls.successUrl,
    cancel_url: urls.cancelUrl,
  }

  // Reuse existing Stripe customer to avoid duplicates.
  // When no existing customer, Stripe collects the email at checkout.
  if (agency.stripe_customer_id) {
    params.customer = agency.stripe_customer_id
  }

  // Coupon (e.g. founding-member 50% off) — applied when the caller passes one.
  if (urls.coupon) {
    params.discounts = [{ coupon: urls.coupon }]
  }

  // Pass billing/legal data to Stripe via metadata for invoice rendering
  if (agency.legal_name) {
    params.metadata = {
      ...params.metadata,
      legal_name: agency.legal_name,
    }
  }

  return params
}
