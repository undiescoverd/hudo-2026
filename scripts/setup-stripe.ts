/**
 * scripts/setup-stripe.ts — Mode-agnostic Stripe product/price setup.
 *
 * Run:  node --import tsx --env-file=<env-file> scripts/setup-stripe.ts
 *
 * Test vs live is determined purely by the STRIPE_SECRET_KEY prefix:
 *   sk_test_… → TEST mode (safe to run frequently)
 *   sk_live_… → LIVE mode (prints a prominent warning)
 *
 * Idempotent — safe to re-run at any time.
 *
 * What it does per paid plan:
 *   1. Ensure the Stripe Product exists (matched by metadata.plan, falling back to name).
 *      Refreshes description + metadata on every run.
 *   2. Ensure the MONTHLY and ANNUAL recurring Prices exist with the correct lookup_key.
 *      Prices are found by lookup_key first (immutable once set); created if absent.
 *      NOTE: If a lookup_key is already held by a *different* price, Stripe will error
 *      unless you pass `transfer_lookup_key: true` on the create call. On the very first
 *      run this is safe because the old setup-stripe-test.mjs prices had no lookup_keys.
 *      On a re-run the lookup is found and we skip creation entirely.
 *   3. Archive (active: false) any other active recurring price on the product that does
 *      NOT carry one of our current lookup_keys (sweeps the old £49/£149/£349 prices).
 *      Prices are never deleted and subscriptions are never touched.
 *
 * Tier numbers come entirely from lib/plans.ts — no magic literals here.
 */

import Stripe from 'stripe'
import { PLANS, PAID_PLAN_IDS } from '../lib/plans'

async function main() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    console.error('ERROR: STRIPE_SECRET_KEY is not set.')
    process.exit(1)
  }

  const isTest = key.startsWith('sk_test_')
  const isLive = key.startsWith('sk_live_')
  if (!isTest && !isLive) {
    console.error(`ERROR: STRIPE_SECRET_KEY does not look like a Stripe secret key (got: ${key.slice(0, 12)}…)`)
    process.exit(1)
  }

  console.log('='.repeat(60))
  if (isLive) {
    console.log('  !! LIVE MODE — changes will affect real Stripe account !!')
  } else {
    console.log('  TEST MODE — operating against Stripe test data')
  }
  console.log(`  Key: ${key.slice(0, 12)}…`)
  console.log('='.repeat(60))
  console.log()

  // Live mode mutates real products/prices and archives the old ones. Require an
  // explicit confirmation so an accidental run (wrong env file, scripted deploy)
  // cannot silently rewrite the live catalogue. Bypass with `--yes` for intentional
  // unattended runs. Test mode proceeds without a prompt.
  if (isLive && !process.argv.includes('--yes')) {
    const { createInterface } = await import('node:readline/promises')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question('  Type YES to proceed with LIVE Stripe mutations: ')
    rl.close()
    if (answer.trim() !== 'YES') {
      console.log('Aborted — no changes made.')
      process.exit(0)
    }
    console.log()
  }

  const stripe = new Stripe(key, { apiVersion: '2026-05-27.dahlia' })

  // ── Summary counters ────────────────────────────────────────────────────────
  const summary = {
    products: { created: [] as string[], updated: [] as string[], skipped: [] as string[] },
    prices: { created: [] as string[], skipped: [] as string[] },
    archived: [] as string[],
    coupons: { created: [] as string[], skipped: [] as string[] },
  }

  // ── Products & prices ───────────────────────────────────────────────────────
  for (const planId of PAID_PLAN_IDS) {
    const plan = PLANS[planId]
    console.log(`── ${plan.displayName} (${planId}) ──────────────────────────────`)

    // ── 1. Product ────────────────────────────────────────────────────────────
    // Match by metadata.plan first (stable); fall back to name.
    // Stripe products.list doesn't support metadata filters, so we page through.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let product: any = null

    for await (const p of stripe.products.list({ limit: 100, active: true })) {
      if (p.metadata?.plan === planId) {
        product = p
        break
      }
    }
    // Fallback: match by name (catches products created by the old script with no metadata.plan)
    if (!product) {
      for await (const p of stripe.products.list({ limit: 100 })) {
        if (p.name === plan.displayName) {
          product = p
          break
        }
      }
    }

    const productDescription = `${plan.displayName} plan — ${plan.agentSeats} agent seats, unlimited talent, ${plan.storageLimitBytes} bytes storage`
    const productMetadata = {
      plan: planId,
      agent_seats: String(plan.agentSeats),
      talent_limit: 'unlimited',
      storage_bytes: String(plan.storageLimitBytes),
    }

    if (product) {
      // Refresh description + metadata to stay in sync with plans.ts
      product = await stripe.products.update(product.id, {
        description: productDescription,
        metadata: productMetadata,
      })
      console.log(`  [~] Product "${plan.displayName}" updated: ${product.id}`)
      summary.products.updated.push(`${plan.displayName} (${product.id})`)
    } else {
      product = await stripe.products.create({
        name: plan.displayName,
        description: productDescription,
        metadata: productMetadata,
      })
      console.log(`  [+] Product "${plan.displayName}" created: ${product.id}`)
      summary.products.created.push(`${plan.displayName} (${product.id})`)
    }

    // ── 2. Prices ─────────────────────────────────────────────────────────────
    const priceDefs = [
      {
        label: 'monthly',
        lookupKey: plan.stripeLookupKeyMonthly as string,
        unitAmount: plan.monthlyPricePence,
        interval: 'month' as const,
      },
      {
        label: 'annual',
        lookupKey: plan.stripeLookupKeyAnnual as string,
        unitAmount: plan.annualPricePence,
        interval: 'year' as const,
      },
    ]

    const currentLookupKeys = new Set(priceDefs.map(d => d.lookupKey))

    for (const def of priceDefs) {
      // Look up by lookup_key first — canonical price identity.
      const existing = await stripe.prices.list({
        lookup_keys: [def.lookupKey],
        active: true,
        limit: 1,
      })

      if (existing.data.length > 0) {
        const p = existing.data[0]
        console.log(`  [=] Price ${def.label} (${def.lookupKey}) already exists: ${p.id}  £${(p.unit_amount ?? 0) / 100}`)
        summary.prices.skipped.push(`${plan.displayName} ${def.label} (${p.id})`)
      } else {
        // NOTE: On first run this is safe because old prices have no lookup_keys.
        // On a re-run the price is found above and we skip. If you ever need to
        // transfer a lookup_key from an existing price to a new one, add
        // `transfer_lookup_key: true` to this create call.
        const p = await stripe.prices.create({
          product: product!.id,
          currency: 'gbp',
          unit_amount: def.unitAmount,
          recurring: { interval: def.interval },
          lookup_key: def.lookupKey,
          nickname: `${plan.displayName} ${def.label.charAt(0).toUpperCase() + def.label.slice(1)}`,
        })
        console.log(`  [+] Price ${def.label} (${def.lookupKey}) created: ${p.id}  £${(p.unit_amount ?? 0) / 100}`)
        summary.prices.created.push(`${plan.displayName} ${def.label} (${p.id})`)
      }
    }

    // ── 3. Archive old prices (no current lookup_key) ─────────────────────────
    const allActivePrices = await stripe.prices.list({
      product: product!.id,
      active: true,
      limit: 100,
      type: 'recurring',
    })
    for (const p of allActivePrices.data) {
      if (!p.lookup_key || !currentLookupKeys.has(p.lookup_key)) {
        await stripe.prices.update(p.id, { active: false })
        const amountStr = `£${(p.unit_amount ?? 0) / 100}/${p.recurring?.interval}`
        console.log(`  [-] Archived old price: ${p.id}  lookup_key=${p.lookup_key ?? 'none'}  ${amountStr}`)
        summary.archived.push(`${p.id} (${plan.displayName}, ${amountStr})`)
      }
    }

    console.log()
  }

  // ── FOUNDING_50 coupon ──────────────────────────────────────────────────────
  console.log('── Coupons ───────────────────────────────────────────────────────')
  try {
    const coupon = await stripe.coupons.retrieve('FOUNDING_50')
    console.log(`  [=] Coupon FOUNDING_50 already exists: ${coupon.id}`)
    summary.coupons.skipped.push('FOUNDING_50')
  } catch (err: unknown) {
    // Stripe throws with code 'resource_missing' on 404; any other error must propagate.
    const stripeErr = err as { code?: string }
    if (stripeErr?.code !== 'resource_missing') throw err
    await stripe.coupons.create({
      id: 'FOUNDING_50',
      name: 'Founding Member — 50% off for 12 months',
      percent_off: 50,
      duration: 'repeating',
      duration_in_months: 12,
      currency: 'gbp',
    })
    console.log('  [+] Coupon FOUNDING_50 created')
    summary.coupons.created.push('FOUNDING_50')
  }
  console.log()

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`Products  — created: ${summary.products.created.length}, updated: ${summary.products.updated.length}, skipped: ${summary.products.skipped.length}`)
  console.log(`Prices    — created: ${summary.prices.created.length}, skipped: ${summary.prices.skipped.length}`)
  console.log(`Archived  — ${summary.archived.length} old price(s)`)
  console.log(`Coupons   — created: ${summary.coupons.created.length}, skipped: ${summary.coupons.skipped.length}`)
  if (summary.archived.length > 0) {
    console.log('\nArchived prices:')
    summary.archived.forEach(s => console.log(`  - ${s}`))
  }
  console.log()
  if (isLive) {
    console.log('!! LIVE MODE run complete.')
  } else {
    console.log('TEST MODE run complete.')
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
