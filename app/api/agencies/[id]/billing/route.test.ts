/**
 * Unit tests for /api/agencies/[id]/billing route.
 *
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 * Focuses on source invariants (security-critical patterns) and the
 * pure validation logic via billing-checkout helpers.
 *
 * Run: npx tsx --test "app/api/agencies/[id]/billing/route.test.ts"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

// ---------------------------------------------------------------------------
// Source invariants — security-critical patterns
// ---------------------------------------------------------------------------

describe('billing route — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const routePath = path.resolve(currentDir, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('imports server-only', () => {
    assert.match(source, /import 'server-only'/)
  })

  it('exports PATCH handler', () => {
    assert.match(source, /export async function PATCH/)
  })

  it('exports POST handler', () => {
    assert.match(source, /export async function POST/)
  })

  it('checks isBillingEnabled feature flag', () => {
    assert.match(source, /isBillingEnabled\(\)/)
  })

  it('requires authentication — returns 401', () => {
    assert.match(source, /status: 401/)
  })

  it('restricts to owner role only (not agent or admin_agent)', () => {
    assert.match(source, /owner role required/)
    // Must NOT use the broader AGENT_PLUS_ROLES helper
    assert.doesNotMatch(source, /requireAgentRole/)
    assert.doesNotMatch(source, /AGENT_PLUS_ROLES/)
  })

  it('validates preconditions from DB (not just request body)', () => {
    // Fetches agency from DB before validation
    assert.match(source, /admin\s*\n?\s*\.from\('agencies'\)/)
    assert.match(source, /validateCheckoutPreconditions/)
  })

  it('sets metadata.agency_id on checkout session (webhook convergence)', () => {
    assert.match(source, /agency_id/)
    // buildCheckoutSessionParams carries metadata.agency_id
    assert.match(source, /buildCheckoutSessionParams/)
  })

  it('applies rate limiting', () => {
    assert.match(source, /checkRateLimit/)
  })

  it('calls logEvent for audit', () => {
    assert.match(source, /logEvent/)
  })

  it('uses service role client for DB writes (createAdminClient)', () => {
    assert.match(source, /createAdminClient\(\)/)
  })

  it('uses createServerClient for auth', () => {
    assert.match(source, /createServerClient/)
  })

  it('validates agency UUID', () => {
    assert.match(source, /isValidUUID\(agencyId\)/)
  })

  it('does not return Stripe secret key in any response', () => {
    assert.doesNotMatch(source, /STRIPE_SECRET_KEY.*NextResponse/)
    assert.doesNotMatch(source, /NextResponse.*STRIPE_SECRET_KEY/)
  })

  it('validates plan is a paid plan (not freemium)', () => {
    assert.match(source, /isPaidPlan/)
    assert.match(source, /starter.*studio.*agency_pro/)
  })

  it('returns 404 when billing is disabled', () => {
    const matches = source.match(/status: 404/g) ?? []
    assert.ok(matches.length >= 1, 'Expected 404 for disabled billing flag')
  })
})

// ---------------------------------------------------------------------------
// Validation logic — via billing-checkout helpers (no Next.js/server imports)
// ---------------------------------------------------------------------------

describe('billing checkout — validation rejects missing legal_name', () => {
  it('returns error when legal_name is null', async () => {
    const { validateCheckoutPreconditions } = await import('@/lib/billing-checkout')
    const result = validateCheckoutPreconditions({
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      legal_name: null,
      billing_address: {
        line1: '1 High St',
        city: 'London',
        postal_code: 'SW1A 1AA',
        country: 'GB',
      },
      dpa_accepted_at: '2026-06-18T10:00:00Z',
      is_founding_member: false,
    })
    assert.ok(!result.ok)
    assert.match(result.ok === false ? result.error : '', /legal_name/)
    assert.equal(result.ok === false ? result.status : 0, 422)
  })
})

describe('billing checkout — validation rejects missing DPA acceptance', () => {
  it('returns error when dpa_accepted_at is null', async () => {
    const { validateCheckoutPreconditions } = await import('@/lib/billing-checkout')
    const result = validateCheckoutPreconditions({
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      legal_name: 'Acme Ltd',
      billing_address: {
        line1: '1 High St',
        city: 'London',
        postal_code: 'SW1A 1AA',
        country: 'GB',
      },
      dpa_accepted_at: null,
      is_founding_member: false,
    })
    assert.ok(!result.ok)
    assert.match(result.ok === false ? result.error : '', /Data Processing Agreement/)
    assert.equal(result.ok === false ? result.status : 0, 422)
  })
})

describe('billing checkout — session params include metadata.agency_id', () => {
  it('sets metadata.agency_id to the agency UUID', async () => {
    const { buildCheckoutSessionParams } = await import('@/lib/billing-checkout')
    const agencyId = 'aaaaaaaa-0000-0000-0000-000000000001'
    const params = buildCheckoutSessionParams(
      {
        id: agencyId,
        legal_name: 'Acme Talent Ltd',
        billing_address: {
          line1: '1 High St',
          city: 'London',
          postal_code: 'SW1A 1AA',
          country: 'GB',
        },
        dpa_accepted_at: '2026-06-18T10:00:00Z',
        is_founding_member: false,
      },
      'starter',
      {
        successUrl: 'https://app.hudo.io/settings/billing?checkout=success',
        cancelUrl: 'https://app.hudo.io/settings/billing?checkout=canceled',
        priceId: 'price_test_starter',
        coupon: null,
      }
    )
    assert.equal(params.metadata?.agency_id, agencyId)
  })
})
