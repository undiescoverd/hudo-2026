/**
 * lib/stripe.test.ts — Correctness guard for plan resolution helpers.
 *
 * Tests:
 *   1. lookup_key resolution for both billing intervals (critical: annual must not downgrade)
 *   2. GRANDFATHERING — legacy price IDs (no lookup_key) map to the correct plan
 *   3. Precedence — lookup_key wins over a coincidental legacy id match
 *   4. Unknown price → 'freemium' (safe fallback)
 *   5. getCheckoutLookupKey — all paid plans × {month,year}
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type Stripe from 'stripe'
import { getPlanFromPrice, getCheckoutLookupKey, LEGACY_PRICE_ID_TO_PLAN } from './stripe'

// ---------------------------------------------------------------------------
// Helpers to build minimal Stripe.Price-shaped objects
// ---------------------------------------------------------------------------

function makePrice(id: string, lookup_key: string | null): Stripe.Price {
  return { id, lookup_key } as unknown as Stripe.Price
}

// ---------------------------------------------------------------------------
// 1. lookup_key resolution — BOTH intervals
// ---------------------------------------------------------------------------

describe('getPlanFromPrice — lookup_key resolution', () => {
  it('resolves starter_monthly → starter', () => {
    assert.equal(getPlanFromPrice(makePrice('price_any', 'starter_monthly')), 'starter')
  })

  it('resolves starter_annual → starter (annual must not downgrade)', () => {
    assert.equal(getPlanFromPrice(makePrice('price_any', 'starter_annual')), 'starter')
  })

  it('resolves studio_monthly → studio', () => {
    assert.equal(getPlanFromPrice(makePrice('price_any', 'studio_monthly')), 'studio')
  })

  it('resolves studio_annual → studio (annual must not downgrade)', () => {
    assert.equal(getPlanFromPrice(makePrice('price_any', 'studio_annual')), 'studio')
  })

  it('resolves agency_pro_monthly → agency_pro', () => {
    assert.equal(getPlanFromPrice(makePrice('price_any', 'agency_pro_monthly')), 'agency_pro')
  })

  it('resolves agency_pro_annual → agency_pro (annual must not downgrade)', () => {
    assert.equal(getPlanFromPrice(makePrice('price_any', 'agency_pro_annual')), 'agency_pro')
  })
})

// ---------------------------------------------------------------------------
// 2. GRANDFATHERING — legacy price IDs (lookup_key: null)
// ---------------------------------------------------------------------------

describe('getPlanFromPrice — grandfathering (legacy price IDs, no lookup_key)', () => {
  // LIVE price IDs
  it('maps live starter price ID → starter', () => {
    assert.equal(getPlanFromPrice(makePrice('price_1Tj62rACrrYvovCO7KSCJoNG', null)), 'starter')
  })

  it('maps live studio price ID → studio', () => {
    assert.equal(getPlanFromPrice(makePrice('price_1Tj62rACrrYvovCOJSq5bDTe', null)), 'studio')
  })

  it('maps live agency_pro price ID → agency_pro', () => {
    assert.equal(getPlanFromPrice(makePrice('price_1Tj62sACrrYvovCOYFJ6Afa4', null)), 'agency_pro')
  })

  it('maps live freemium price ID → freemium', () => {
    assert.equal(getPlanFromPrice(makePrice('price_1Tj62qACrrYvovCOdEQ8Na6A', null)), 'freemium')
  })

  // TEST price IDs
  it('maps test starter price ID → starter', () => {
    assert.equal(getPlanFromPrice(makePrice('price_1Tj85JPE8Ih3LOAA2sQEqx1D', null)), 'starter')
  })

  it('maps test studio price ID → studio', () => {
    assert.equal(getPlanFromPrice(makePrice('price_1Tj85KPE8Ih3LOAA3nTZcplc', null)), 'studio')
  })

  it('maps test agency_pro price ID → agency_pro', () => {
    assert.equal(getPlanFromPrice(makePrice('price_1Tj85LPE8Ih3LOAAwghsraL5', null)), 'agency_pro')
  })

  it('maps test freemium price ID → freemium', () => {
    assert.equal(getPlanFromPrice(makePrice('price_1Tj85HPE8Ih3LOAAztAGBtDJ', null)), 'freemium')
  })
})

// ---------------------------------------------------------------------------
// 3. Precedence — lookup_key wins over legacy id
// ---------------------------------------------------------------------------

describe('getPlanFromPrice — lookup_key takes precedence over legacy id', () => {
  it('resolves to studio (lookup_key) even when id matches legacy starter entry', () => {
    // Price that has a studio lookup_key but the id of a legacy starter price.
    // lookup_key should win — otherwise a future price migration would misclassify.
    const price = makePrice('price_1Tj62rACrrYvovCO7KSCJoNG', 'studio_monthly')
    assert.equal(getPlanFromPrice(price), 'studio')
  })

  it('resolves to agency_pro (lookup_key) even when id is a legacy starter test id', () => {
    const price = makePrice('price_1Tj85JPE8Ih3LOAA2sQEqx1D', 'agency_pro_annual')
    assert.equal(getPlanFromPrice(price), 'agency_pro')
  })
})

// ---------------------------------------------------------------------------
// 4. Unknown price → 'freemium' (safe default, never silent upgrade)
// ---------------------------------------------------------------------------

describe('getPlanFromPrice — unknown price fallback', () => {
  it('returns freemium for a price with no lookup_key and an unknown id', () => {
    assert.equal(getPlanFromPrice(makePrice('price_unknown_xyz', null)), 'freemium')
  })

  it('returns freemium for an unrecognised lookup_key', () => {
    assert.equal(getPlanFromPrice(makePrice('price_any', 'enterprise_monthly')), 'freemium')
  })
})

// ---------------------------------------------------------------------------
// 5. getCheckoutLookupKey — all paid plans × {month, year}
// ---------------------------------------------------------------------------

describe('getCheckoutLookupKey', () => {
  it('starter × month → starter_monthly', () => {
    assert.equal(getCheckoutLookupKey('starter', 'month'), 'starter_monthly')
  })

  it('starter × year → starter_annual', () => {
    assert.equal(getCheckoutLookupKey('starter', 'year'), 'starter_annual')
  })

  it('studio × month → studio_monthly', () => {
    assert.equal(getCheckoutLookupKey('studio', 'month'), 'studio_monthly')
  })

  it('studio × year → studio_annual', () => {
    assert.equal(getCheckoutLookupKey('studio', 'year'), 'studio_annual')
  })

  it('agency_pro × month → agency_pro_monthly', () => {
    assert.equal(getCheckoutLookupKey('agency_pro', 'month'), 'agency_pro_monthly')
  })

  it('agency_pro × year → agency_pro_annual', () => {
    assert.equal(getCheckoutLookupKey('agency_pro', 'year'), 'agency_pro_annual')
  })
})

// ---------------------------------------------------------------------------
// 6. LEGACY_PRICE_ID_TO_PLAN integrity — all 8 entries must be present
// ---------------------------------------------------------------------------

describe('LEGACY_PRICE_ID_TO_PLAN integrity', () => {
  const expectedEntries: Array<[string, string]> = [
    // Live
    ['price_1Tj62qACrrYvovCOdEQ8Na6A', 'freemium'],
    ['price_1Tj62rACrrYvovCO7KSCJoNG', 'starter'],
    ['price_1Tj62rACrrYvovCOJSq5bDTe', 'studio'],
    ['price_1Tj62sACrrYvovCOYFJ6Afa4', 'agency_pro'],
    // Test
    ['price_1Tj85HPE8Ih3LOAAztAGBtDJ', 'freemium'],
    ['price_1Tj85JPE8Ih3LOAA2sQEqx1D', 'starter'],
    ['price_1Tj85KPE8Ih3LOAA3nTZcplc', 'studio'],
    ['price_1Tj85LPE8Ih3LOAAwghsraL5', 'agency_pro'],
  ]

  for (const [id, plan] of expectedEntries) {
    it(`LEGACY_PRICE_ID_TO_PLAN['${id}'] === '${plan}'`, () => {
      assert.equal(LEGACY_PRICE_ID_TO_PLAN[id], plan)
    })
  }
})
