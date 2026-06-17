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

// Populated after running: node --env-file=.env.local scripts/setup-stripe-test.mjs
const STRIPE_PRICES_TEST: Record<string, string> = {
  freemium: 'price_1Tj85HPE8Ih3LOAAztAGBtDJ',
  starter: 'price_1Tj85JPE8Ih3LOAA2sQEqx1D',
  studio: 'price_1Tj85KPE8Ih3LOAA3nTZcplc',
  agency_pro: 'price_1Tj85LPE8Ih3LOAAwghsraL5',
}

export type StripePlan = keyof typeof STRIPE_PRICES_LIVE

export function getStripePriceId(plan: StripePlan): string {
  const isTest = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')
  const prices = isTest ? STRIPE_PRICES_TEST : STRIPE_PRICES_LIVE
  const id = prices[plan]
  if (!id)
    throw new Error(
      `No Stripe price ID configured for plan "${plan}" in ${isTest ? 'test' : 'live'} mode`
    )
  return id
}

export const FOUNDING_COUPON = 'FOUNDING_50'
