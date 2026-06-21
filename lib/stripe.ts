/**
 * lib/stripe.ts — Stripe SDK singleton + price resolution helpers.
 *
 * PLAN RESOLUTION ORDER (critical — a mistake silently downgrades paying customers):
 *
 *   1. lookup_key path (new subscribers, post-migration):
 *      Stripe prices created with `getLookupKey(planId, interval)` carry a lookup_key
 *      like "starter_monthly". `getPlanFromLookupKey` maps that back to a PlanId.
 *      This is the primary path and handles monthly AND annual prices correctly.
 *
 *   2. LEGACY_PRICE_ID_TO_PLAN (grandfathered subscribers):
 *      Early subscribers' prices were created WITHOUT lookup_keys (the legacy
 *      STRIPE_PRICES_LIVE / STRIPE_PRICES_TEST era). Their subscription.updated events
 *      still carry a price.id from that era. We must map those IDs here or they would
 *      silently resolve to 'freemium'.
 *      NEVER DELETE entries from LEGACY_PRICE_ID_TO_PLAN.
 *
 *   3. Fallback to 'freemium' for truly unknown prices (safe default).
 */

import Stripe from 'stripe'
import {
  type PlanId,
  type PaidPlanId,
  type BillingInterval,
  getPlanFromLookupKey,
  getLookupKey,
} from '@/lib/plans'

// Re-export PlanId as StripePlan so callers that referenced StripePlan don't break.
export type StripePlan = PlanId

// ---------------------------------------------------------------------------
// Stripe singleton — never instantiated at module scope to avoid build-time
// crashes when STRIPE_SECRET_KEY is absent.
// ---------------------------------------------------------------------------

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
    _stripe = new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
  }
  return _stripe
}

// ---------------------------------------------------------------------------
// Founding-member coupon — 50% off for 12 months, applied at checkout when
// agencies.is_founding_member = true.
// ---------------------------------------------------------------------------

export const FOUNDING_COUPON = 'FOUNDING_50'

// ---------------------------------------------------------------------------
// LEGACY_PRICE_ID_TO_PLAN
//
// Price IDs created before the lookup_key migration. These prices have no
// lookup_key and cannot be resolved via getPlanFromLookupKey. Entries MUST
// stay here forever — removing them would silently downgrade any subscriber
// still on one of these prices to 'freemium'.
//
// To verify a price's lookup_key status:
//   stripe prices retrieve <price_id> (look for lookup_key: null)
// ---------------------------------------------------------------------------

export const LEGACY_PRICE_ID_TO_PLAN: Readonly<Record<string, PlanId>> = {
  // Live price IDs (production Stripe account)
  price_1Tj62qACrrYvovCOdEQ8Na6A: 'freemium',
  price_1Tj62rACrrYvovCO7KSCJoNG: 'starter',
  price_1Tj62rACrrYvovCOJSq5bDTe: 'studio',
  price_1Tj62sACrrYvovCOYFJ6Afa4: 'agency_pro',
  // Test price IDs (Stripe test-mode account — sk_test_*)
  price_1Tj85HPE8Ih3LOAAztAGBtDJ: 'freemium',
  price_1Tj85JPE8Ih3LOAA2sQEqx1D: 'starter',
  price_1Tj85KPE8Ih3LOAA3nTZcplc: 'studio',
  price_1Tj85LPE8Ih3LOAAwghsraL5: 'agency_pro',
} as const

// ---------------------------------------------------------------------------
// resolvePriceId
//
// Looks up the active Stripe price object for a given lookup_key. Used when
// creating a checkout session — pass the lookup_key from getLookupKey() and
// get back the price ID to attach to the session line_items.
// ---------------------------------------------------------------------------

/**
 * Resolve a Stripe lookup_key to its active price ID via the Stripe API.
 *
 * @throws if no active price is found for the given lookup_key — prevents
 *         silently creating a checkout session with a missing/deactivated price.
 */
export async function resolvePriceId(lookupKey: string): Promise<string> {
  const result = await getStripe().prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 2,
  })
  if (result.data.length === 0) {
    throw new Error(
      `No active Stripe price found for lookup_key "${lookupKey}". ` +
        `Run scripts/setup-stripe.ts to create it, or check the Stripe dashboard.`
    )
  }
  if (result.data.length > 1) {
    // setup-stripe.ts archives old prices, so exactly one active price should
    // own a lookup_key. More than one is ambiguous — refuse rather than guess.
    throw new Error(
      `Multiple active Stripe prices share lookup_key "${lookupKey}". ` +
        `Archive the stale price(s) in the Stripe dashboard so exactly one is active.`
    )
  }
  return result.data[0].id
}

// ---------------------------------------------------------------------------
// getCheckoutLookupKey
//
// Thin wrapper around getLookupKey from plans.ts — exists so billing code
// can import one module for all Stripe concerns rather than mixing plans.ts
// and stripe.ts imports.
// ---------------------------------------------------------------------------

/**
 * Returns the Stripe lookup_key for a paid plan + billing interval.
 * Pass the result to resolvePriceId() to obtain a price ID for checkout.
 */
export function getCheckoutLookupKey(planId: PaidPlanId, interval: BillingInterval): string {
  return getLookupKey(planId, interval)
}

// ---------------------------------------------------------------------------
// getPlanFromPrice
//
// The authoritative reverse-lookup used by the Stripe webhook handler to turn
// a subscription item's Stripe.Price into a PlanId.
//
// Resolution order (see module-level comment for rationale):
//   1. lookup_key  → getPlanFromLookupKey   (new subscribers)
//   2. price.id    → LEGACY_PRICE_ID_TO_PLAN (grandfathered subscribers)
//   3. fallback    → 'freemium'
// ---------------------------------------------------------------------------

/**
 * Map a Stripe Price object to a Hudo PlanId.
 *
 * Always prefer this over raw price-ID lookups — it handles both current
 * lookup_key-based prices and legacy grandfathered price IDs in one call.
 *
 * NEVER return a non-freemium default here; the only safe unknown-price
 * fallback is 'freemium' (never grant features silently).
 */
export function getPlanFromPrice(price: Stripe.Price): PlanId {
  // 1. lookup_key path — all prices created post-migration carry one.
  const fromLookupKey = getPlanFromLookupKey(price.lookup_key)
  if (fromLookupKey !== null) return fromLookupKey

  // 2. Legacy price ID path — grandfathered subscribers have no lookup_key.
  const fromLegacy = LEGACY_PRICE_ID_TO_PLAN[price.id]
  if (fromLegacy !== undefined) return fromLegacy

  // 3. Unknown price — safest default is freemium (no silent upgrades).
  return 'freemium'
}
