/**
 * Unit tests for lib/billing-checkout.ts
 *
 * Pure-logic tests — no Next.js runtime, no server-only, no Stripe/Supabase API calls.
 *
 * Run: npx tsx --test "lib/billing-checkout.test.ts"
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  validateCheckoutPreconditions,
  buildCheckoutSessionParams,
  isPaidPlan,
  type AgencyCheckoutData,
  type PaidPlan,
} from './billing-checkout.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgency(overrides: Partial<AgencyCheckoutData> = {}): AgencyCheckoutData {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    legal_name: 'Acme Talent Ltd',
    billing_address: {
      line1: '1 High Street',
      city: 'London',
      postal_code: 'SW1A 1AA',
      country: 'GB',
    },
    dpa_accepted_at: '2026-06-18T10:00:00Z',
    is_founding_member: false,
    stripe_customer_id: null,
    ...overrides,
  }
}

const VALID_URLS = {
  successUrl: 'https://app.hudo.io/settings/billing?success=1',
  cancelUrl: 'https://app.hudo.io/settings/billing?canceled=1',
  priceId: 'price_test_starter',
  coupon: null as string | null,
}

// ---------------------------------------------------------------------------
// isPaidPlan
// ---------------------------------------------------------------------------

describe('isPaidPlan', () => {
  it('returns true for starter', () => {
    assert.ok(isPaidPlan('starter'))
  })

  it('returns true for studio', () => {
    assert.ok(isPaidPlan('studio'))
  })

  it('returns true for agency_pro', () => {
    assert.ok(isPaidPlan('agency_pro'))
  })

  it('returns false for freemium', () => {
    assert.ok(!isPaidPlan('freemium'))
  })

  it('returns false for unknown strings', () => {
    assert.ok(!isPaidPlan('enterprise'))
    assert.ok(!isPaidPlan(''))
  })
})

// ---------------------------------------------------------------------------
// validateCheckoutPreconditions — BILLING-004
// ---------------------------------------------------------------------------

describe('validateCheckoutPreconditions — legal_name', () => {
  it('accepts a fully valid agency', () => {
    const result = validateCheckoutPreconditions(makeAgency())
    assert.deepEqual(result, { ok: true })
  })

  it('rejects when legal_name is null', () => {
    const result = validateCheckoutPreconditions(makeAgency({ legal_name: null }))
    assert.ok(!result.ok)
    assert.match(result.ok === false ? result.error : '', /legal_name/)
    assert.equal(result.ok === false ? result.status : 0, 422)
  })

  it('rejects when legal_name is empty string', () => {
    const result = validateCheckoutPreconditions(makeAgency({ legal_name: '' }))
    assert.ok(!result.ok)
    assert.match(result.ok === false ? result.error : '', /legal_name/)
  })

  it('rejects when legal_name is whitespace only', () => {
    const result = validateCheckoutPreconditions(makeAgency({ legal_name: '   ' }))
    assert.ok(!result.ok)
    assert.match(result.ok === false ? result.error : '', /legal_name/)
  })
})

describe('validateCheckoutPreconditions — billing_address', () => {
  it('rejects when billing_address is null', () => {
    const result = validateCheckoutPreconditions(makeAgency({ billing_address: null }))
    assert.ok(!result.ok)
    assert.match(result.ok === false ? result.error : '', /billing_address/)
    assert.equal(result.ok === false ? result.status : 0, 422)
  })

  it('rejects when billing_address is an empty object', () => {
    const result = validateCheckoutPreconditions(makeAgency({ billing_address: {} }))
    assert.ok(!result.ok)
    assert.match(result.ok === false ? result.error : '', /billing_address/)
  })
})

// ---------------------------------------------------------------------------
// validateCheckoutPreconditions — BILLING-006 (DPA gate)
// ---------------------------------------------------------------------------

describe('validateCheckoutPreconditions — dpa_accepted_at', () => {
  it('rejects when DPA has not been accepted (null)', () => {
    const result = validateCheckoutPreconditions(makeAgency({ dpa_accepted_at: null }))
    assert.ok(!result.ok)
    assert.match(result.ok === false ? result.error : '', /Data Processing Agreement/)
    assert.equal(result.ok === false ? result.status : 0, 422)
  })

  it('accepts when DPA has been accepted', () => {
    const result = validateCheckoutPreconditions(
      makeAgency({ dpa_accepted_at: '2026-06-18T12:00:00Z' })
    )
    assert.deepEqual(result, { ok: true })
  })

  // Priority: legal data errors surface before DPA error (first failing guard wins)
  it('surfaces legal_name error before DPA error when both missing', () => {
    const result = validateCheckoutPreconditions(
      makeAgency({ legal_name: null, dpa_accepted_at: null })
    )
    assert.ok(!result.ok)
    assert.match(result.ok === false ? result.error : '', /legal_name/)
  })
})

// ---------------------------------------------------------------------------
// buildCheckoutSessionParams
// ---------------------------------------------------------------------------

describe('buildCheckoutSessionParams — metadata', () => {
  it('includes metadata.agency_id (webhook convergence contract)', () => {
    const agency = makeAgency()
    const params = buildCheckoutSessionParams(agency, 'starter', VALID_URLS)
    assert.equal(params.metadata?.agency_id, agency.id)
  })

  it('sets mode to subscription', () => {
    const params = buildCheckoutSessionParams(makeAgency(), 'studio', VALID_URLS)
    assert.equal(params.mode, 'subscription')
  })

  it('sets success_url and cancel_url', () => {
    const params = buildCheckoutSessionParams(makeAgency(), 'starter', VALID_URLS)
    assert.equal(params.success_url, VALID_URLS.successUrl)
    assert.equal(params.cancel_url, VALID_URLS.cancelUrl)
  })

  it('includes line_items with quantity 1 using the passed priceId', () => {
    const params = buildCheckoutSessionParams(makeAgency(), 'agency_pro', VALID_URLS)
    assert.ok(Array.isArray(params.line_items))
    assert.equal(params.line_items?.length, 1)
    const item = params.line_items?.[0] as { price: string; quantity: number }
    assert.equal(item?.quantity, 1)
    assert.equal(item?.price, VALID_URLS.priceId)
  })
})

describe('buildCheckoutSessionParams — coupon (caller-resolved)', () => {
  it('applies the coupon when one is passed', () => {
    const params = buildCheckoutSessionParams(makeAgency(), 'starter', {
      ...VALID_URLS,
      coupon: 'FOUNDING_50',
    })
    assert.ok(Array.isArray(params.discounts) && params.discounts.length === 1)
    const discount = params.discounts?.[0] as { coupon: string }
    assert.equal(discount?.coupon, 'FOUNDING_50')
  })

  it('does NOT apply a coupon when coupon is null', () => {
    const params = buildCheckoutSessionParams(makeAgency(), 'starter', VALID_URLS)
    assert.ok(!params.discounts || params.discounts.length === 0)
  })
})

describe('buildCheckoutSessionParams — existing customer', () => {
  it('reuses stripe_customer_id when present', () => {
    const agency = makeAgency({ stripe_customer_id: 'cus_existing123' })
    const params = buildCheckoutSessionParams(agency, 'studio', VALID_URLS)
    assert.equal(params.customer, 'cus_existing123')
    assert.equal(params.customer_email, undefined)
  })

  it('does not set customer when stripe_customer_id is null', () => {
    const agency = makeAgency({ stripe_customer_id: null })
    const params = buildCheckoutSessionParams(agency, 'studio', VALID_URLS)
    assert.equal(params.customer, undefined)
  })
})

describe('buildCheckoutSessionParams — plan metadata', () => {
  for (const plan of ['starter', 'studio', 'agency_pro'] as PaidPlan[]) {
    it(`records the plan in metadata for ${plan}`, () => {
      const params = buildCheckoutSessionParams(makeAgency(), plan, VALID_URLS)
      assert.equal(params.metadata?.plan, plan)
    })
  }
})
