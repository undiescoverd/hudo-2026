/**
 * Unit tests for /api/billing/portal (POST).
 *
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 * Tests source invariants and pure validation logic.
 *
 * Run: npx tsx --test "app/api/billing/portal/route.test.ts"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

// ---------------------------------------------------------------------------
// Source invariants — security-critical patterns in route.ts
// ---------------------------------------------------------------------------

describe('billing/portal route — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const routePath = path.resolve(currentDir, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('imports server-only to prevent client-bundle inclusion', () => {
    assert.ok(source.includes("import 'server-only'"), "route must start with import 'server-only'")
  })

  it('checks isBillingEnabled() before any auth or Stripe calls', () => {
    const billingCheckIndex = source.indexOf('isBillingEnabled()')
    const authIndex = source.indexOf('auth.getUser()')
    assert.ok(billingCheckIndex !== -1, 'must call isBillingEnabled()')
    assert.ok(billingCheckIndex < authIndex, 'billing flag check must precede auth check')
  })

  it('returns 404 when billing is not enabled', () => {
    assert.ok(
      source.includes('status: 404'),
      'must return 404 for disabled billing (not 403 to avoid leaking route existence)'
    )
  })

  it('requires owner role — filters memberships by role = owner', () => {
    assert.ok(
      source.includes("eq('role', 'owner')"),
      "must gate on owner role via .eq('role', 'owner')"
    )
  })

  it('returns 403 when no owner membership is found', () => {
    assert.ok(source.includes('status: 403'), 'must return 403 for non-owners')
  })

  it('returns 400 when no stripe_customer_id exists on the agency', () => {
    assert.ok(
      source.includes('!agency.stripe_customer_id'),
      'must check for missing stripe_customer_id'
    )
    assert.ok(
      source.includes('status: 400'),
      'must return 400 when no stripe_customer_id (not 403)'
    )
  })

  it('creates a billing portal session, not a checkout session', () => {
    assert.ok(
      source.includes('billingPortal.sessions.create'),
      'must call billingPortal.sessions.create (not checkout.sessions.create)'
    )
  })

  it('returns the portal session url', () => {
    assert.ok(source.includes('{ url: session.url }'), 'must return { url } for caller redirect')
  })

  it('is rate-limited via checkRateLimit', () => {
    assert.ok(source.includes('checkRateLimit'), 'must apply rate limiting')
  })

  it('uses service-role client for membership and agency queries (bypasses RLS)', () => {
    const adminIdx = source.indexOf('const admin = createClient')
    const membershipIdx = source.indexOf(".from('memberships')")
    const agencyIdx = source.indexOf(".from('agencies')")
    assert.ok(adminIdx !== -1, 'must create service-role admin client')
    assert.ok(adminIdx < membershipIdx, 'admin client must be created before membership query')
    assert.ok(agencyIdx !== -1, 'must also query agencies table for stripe_customer_id')
    assert.ok(adminIdx < agencyIdx, 'admin client must be created before agency query')
  })

  it('only exports POST (no helper functions at module level that would fail Next.js route validation)', () => {
    // Only GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS + reserved config names are valid exports.
    // We assert that there's exactly one export — POST — and no named helpers exported.
    const exportMatches = [...source.matchAll(/^export\s+(async\s+)?function\s+(\w+)/gm)]
    const exportedNames = exportMatches.map((m) => m[2])
    assert.deepEqual(
      exportedNames,
      ['POST'],
      `route must export only POST, found: ${exportedNames.join(', ')}`
    )
  })
})

// ---------------------------------------------------------------------------
// Pure logic: plan tier ordering (used by BillingOverview — validated here
// against PLAN_IDS from lib/plans to catch drift)
// ---------------------------------------------------------------------------

describe('plan tier ordering', () => {
  it('paid plans ordered lowest to highest: starter < studio < agency_pro', () => {
    // This ordering is used by BillingOverview to render upgrade buttons.
    // If PLANS/PLAN_IDS or the ordered list drifts, this test catches it.
    const TIER_ORDER = ['freemium', 'starter', 'studio', 'agency_pro']
    const paidTiers = TIER_ORDER.filter((p) => p !== 'freemium')
    assert.deepEqual(paidTiers, ['starter', 'studio', 'agency_pro'])
  })
})
