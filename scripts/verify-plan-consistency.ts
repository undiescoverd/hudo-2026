/**
 * scripts/verify-plan-consistency.ts — Stripe ↔ lib/plans.ts drift guard.
 *
 * Run:  node --import tsx --env-file=<env-file> scripts/verify-plan-consistency.ts
 *
 * CANNOT run in normal CI — CI has no STRIPE_SECRET_KEY. This is a LOCAL /
 * pre-deploy gate only. Add it to your deploy checklist when changing plan tiers.
 *
 * For each paid plan it fetches the ACTIVE price for each lookup_key and asserts:
 *   - The price exists
 *   - unit_amount  === pence value in lib/plans.ts
 *   - currency     === 'gbp'
 *   - recurring.interval matches ('month' / 'year')
 *   - linked product's metadata.agent_seats and metadata.storage_bytes match lib/plans.ts
 *
 * Scope is strictly `active: true` — archived old prices do NOT trip assertions.
 *
 * Exits 0 if all checks pass, 1 if any drift found (prints every mismatch first).
 */

import Stripe from 'stripe'
import { PLANS, PAID_PLAN_IDS } from '../lib/plans'

async function main() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    console.error('ERROR: STRIPE_SECRET_KEY is not set.')
    process.exit(1)
  }

  const stripe = new Stripe(key, { apiVersion: '2026-05-27.dahlia' })

  const isTest = key.startsWith('sk_test_')
  console.log(`Verifying Stripe ↔ plans.ts consistency [${isTest ? 'TEST' : 'LIVE'} mode]`)
  console.log()

  const mismatches: string[] = []

  for (const planId of PAID_PLAN_IDS) {
    const plan = PLANS[planId]
    console.log(`── ${plan.displayName} (${planId})`)

    const checks = [
      {
        label: 'monthly',
        lookupKey: plan.stripeLookupKeyMonthly as string,
        expectedAmount: plan.monthlyPricePence,
        expectedInterval: 'month' as const,
      },
      {
        label: 'annual',
        lookupKey: plan.stripeLookupKeyAnnual as string,
        expectedAmount: plan.annualPricePence,
        expectedInterval: 'year' as const,
      },
    ]

    for (const check of checks) {
      const result = await stripe.prices.list({
        lookup_keys: [check.lookupKey],
        active: true,
        limit: 1,
      })

      if (result.data.length === 0) {
        const msg = `${planId}/${check.label}: no active price found for lookup_key "${check.lookupKey}"`
        console.log(`  FAIL  ${msg}`)
        mismatches.push(msg)
        continue
      }

      const price = result.data[0]
      let ok = true

      if (price.unit_amount !== check.expectedAmount) {
        const msg = `${planId}/${check.label}: unit_amount ${price.unit_amount} !== expected ${check.expectedAmount} (price ${price.id})`
        console.log(`  FAIL  ${msg}`)
        mismatches.push(msg)
        ok = false
      }

      if (price.currency !== 'gbp') {
        const msg = `${planId}/${check.label}: currency "${price.currency}" !== "gbp" (price ${price.id})`
        console.log(`  FAIL  ${msg}`)
        mismatches.push(msg)
        ok = false
      }

      if (price.recurring?.interval !== check.expectedInterval) {
        const msg = `${planId}/${check.label}: recurring.interval "${price.recurring?.interval}" !== "${check.expectedInterval}" (price ${price.id})`
        console.log(`  FAIL  ${msg}`)
        mismatches.push(msg)
        ok = false
      }

      // Check product metadata — typed loosely so list results and retrieve results unify
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const product: any = typeof price.product === 'string'
        ? await stripe.products.retrieve(price.product)
        : price.product

      const expectedAgentSeats = String(plan.agentSeats)
      const expectedStorageBytes = String(plan.storageLimitBytes)

      if (product.metadata?.agent_seats !== expectedAgentSeats) {
        const msg = `${planId}/${check.label}: product.metadata.agent_seats "${product.metadata?.agent_seats}" !== "${expectedAgentSeats}" (product ${product.id})`
        console.log(`  FAIL  ${msg}`)
        mismatches.push(msg)
        ok = false
      }

      if (product.metadata?.storage_bytes !== expectedStorageBytes) {
        const msg = `${planId}/${check.label}: product.metadata.storage_bytes "${product.metadata?.storage_bytes}" !== "${expectedStorageBytes}" (product ${product.id})`
        console.log(`  FAIL  ${msg}`)
        mismatches.push(msg)
        ok = false
      }

      if (ok) {
        console.log(`  OK    ${check.lookupKey}  £${(price.unit_amount ?? 0) / 100}/${check.expectedInterval}  seats=${expectedAgentSeats}  storage=${expectedStorageBytes}`)
      }
    }

    console.log()
  }

  // ── Result ──────────────────────────────────────────────────────────────────
  if (mismatches.length > 0) {
    console.log('='.repeat(60))
    console.log(`DRIFT DETECTED — ${mismatches.length} mismatch(es):`)
    mismatches.forEach((m, i) => console.log(`  ${i + 1}. ${m}`))
    console.log()
    console.log('Fix: run `node --import tsx --env-file=<env> scripts/setup-stripe.ts`')
    console.log('='.repeat(60))
    process.exit(1)
  } else {
    console.log('='.repeat(60))
    console.log('ALL CHECKS PASSED — Stripe matches lib/plans.ts exactly.')
    console.log('='.repeat(60))
    process.exit(0)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
