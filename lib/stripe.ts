import Stripe from 'stripe'

// Lazy singleton — instantiated inside functions, never at module scope.
// Prevents build-time crash when STRIPE_SECRET_KEY is absent.
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
// Price IDs — test and live kept separate; resolved at runtime by key prefix.
// Run scripts/setup-stripe-test.mjs to populate test IDs after switching keys.
// ---------------------------------------------------------------------------

const STRIPE_PRICES_LIVE = {
  freemium: 'price_1Tj62qACrrYvovCOdEQ8Na6A',
  starter: 'price_1Tj62rACrrYvovCO7KSCJoNG',
  studio: 'price_1Tj62rACrrYvovCOJSq5bDTe',
  agency_pro: 'price_1Tj62sACrrYvovCOYFJ6Afa4',
} as const

export type StripePlan = keyof typeof STRIPE_PRICES_LIVE

// Populated after running: node --env-file=.env.local scripts/setup-stripe-test.mjs
// Typed as Record<StripePlan, string> so TS catches any drift from STRIPE_PRICES_LIVE's keys.
const STRIPE_PRICES_TEST: Record<StripePlan, string> = {
  freemium: 'price_1Tj85HPE8Ih3LOAAztAGBtDJ',
  starter: 'price_1Tj85JPE8Ih3LOAA2sQEqx1D',
  studio: 'price_1Tj85KPE8Ih3LOAA3nTZcplc',
  agency_pro: 'price_1Tj85LPE8Ih3LOAAwghsraL5',
}

export function getStripePriceId(plan: StripePlan): string {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  const isTest = key.startsWith('sk_test_')
  const prices = isTest ? STRIPE_PRICES_TEST : STRIPE_PRICES_LIVE
  const id = prices[plan]
  if (!id)
    throw new Error(
      `No Stripe price ID configured for plan "${plan}" in ${isTest ? 'test' : 'live'} mode`
    )
  return id
}

export const FOUNDING_COUPON = 'FOUNDING_50'

// ---------------------------------------------------------------------------
// Reverse lookup: Stripe price ID → plan name (used by webhook handler).
// Covers both test and live price IDs — checked against both maps at runtime.
// Falls back to 'freemium' for unknown price IDs (safe default).
// ---------------------------------------------------------------------------

// Combined reverse map covering both test and live IDs, built once at module load.
const PRICE_ID_TO_PLAN: Record<string, StripePlan> = {}
for (const [plan, id] of Object.entries(STRIPE_PRICES_LIVE)) {
  PRICE_ID_TO_PLAN[id] = plan as StripePlan
}
for (const [plan, id] of Object.entries(STRIPE_PRICES_TEST)) {
  PRICE_ID_TO_PLAN[id] = plan as StripePlan
}

/** @returns The plan name for a given Stripe price ID, or 'freemium' if unknown. */
export function getPlanFromPriceId(priceId: string): StripePlan {
  return PRICE_ID_TO_PLAN[priceId] ?? 'freemium'
}
