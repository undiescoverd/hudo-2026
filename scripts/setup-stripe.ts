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
 *   4. Ensure the Customer Portal configurations (S5-ADMIN-001), matched by metadata.hudo_role
 *      and re-enforced on every run. `--portal-only` runs just this step.
 *      - Owner = the account DEFAULT (owners' portal sessions pass no configuration):
 *        invoices, payment method, email/address/tax ID, cancel at period end. Plan change
 *        stays in the app's upgrade flow. Created only when the account has no default;
 *        a default set in the Dashboard is left alone.
 *      - Delegate (admin agents granted billing access): invoices + payment method only.
 *        Never the default. Its ID is printed for STRIPE_PORTAL_CONFIG_DELEGATE.
 *
 * Tier numbers come entirely from lib/plans.ts — no magic literals here.
 */

import Stripe from 'stripe'
import { PLANS, PAID_PLAN_IDS } from '../lib/plans'

const DELEGATE_PORTAL_ROLE = 'billing_delegate'
const OWNER_PORTAL_ROLE = 'owner_default'

// Delegate portal: view invoices + update payment method only (passed explicitly by
// /api/billing/portal for admin agents granted billing access).
const DELEGATE_PORTAL_FEATURES: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true },
  customer_update: { enabled: false },
  subscription_cancel: { enabled: false },
  subscription_update: { enabled: false },
}

// Owner (account default) portal: everything except plan change, which goes through the
// app's upgrade flow (legal entity + DPA + Checkout), not the portal.
const OWNER_PORTAL_FEATURES: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true },
  customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id'] },
  subscription_cancel: { enabled: true, mode: 'at_period_end' },
  subscription_update: { enabled: false },
}

async function listPortalConfigs(stripe: Stripe): Promise<Stripe.BillingPortal.Configuration[]> {
  const out: Stripe.BillingPortal.Configuration[] = []
  for await (const c of stripe.billingPortal.configurations.list({ active: true, limit: 100 })) out.push(c)
  return out
}

/**
 * Owners get the account's DEFAULT portal configuration (the route passes no
 * `configuration` for them). Stripe makes the first configuration on an account the
 * default, so the owner one must exist before the delegate one is created. An existing
 * default is never touched unless this script created it (metadata.hudo_role).
 */
async function ensureOwnerDefaultPortalConfig(stripe: Stripe): Promise<string> {
  const configs = await listPortalConfigs(stripe)
  const current = configs.find((c) => c.is_default)
  if (current && current.metadata?.hudo_role === DELEGATE_PORTAL_ROLE) {
    // Repair: a restricted delegate config must never be the default. Turn it into the
    // owner default; a fresh delegate config is created afterwards.
    const c = await stripe.billingPortal.configurations.update(current.id, {
      name: 'Hudo owner (default)',
      features: OWNER_PORTAL_FEATURES,
      metadata: { hudo_role: OWNER_PORTAL_ROLE },
    })
    console.log(`  [~] Default portal configuration was the delegate one; converted to owner default: ${c.id}`)
    return c.id
  }
  if (current && current.metadata?.hudo_role === OWNER_PORTAL_ROLE) {
    const c = await stripe.billingPortal.configurations.update(current.id, { features: OWNER_PORTAL_FEATURES })
    console.log(`  [~] Owner default portal configuration re-enforced: ${c.id}`)
    return c.id
  }
  if (current) {
    console.log(`  [=] Default portal configuration set outside this script, left as is: ${current.id}`)
    return current.id
  }
  const c = await stripe.billingPortal.configurations.create({
    name: 'Hudo owner (default)',
    features: OWNER_PORTAL_FEATURES,
    metadata: { hudo_role: OWNER_PORTAL_ROLE },
  })
  console.log(`  [+] Owner default portal configuration created: ${c.id}${c.is_default ? '' : ' (not default!)'}`)
  return c.id
}

/** Find (by metadata, never the default) or create the delegate portal configuration. */
async function ensureDelegatePortalConfig(stripe: Stripe): Promise<string> {
  const existing = (await listPortalConfigs(stripe)).find(
    (c) => !c.is_default && c.metadata?.hudo_role === DELEGATE_PORTAL_ROLE
  )
  let config: Stripe.BillingPortal.Configuration
  if (existing) {
    config = await stripe.billingPortal.configurations.update(existing.id, {
      features: DELEGATE_PORTAL_FEATURES,
    })
    console.log(`  [~] Delegate portal configuration re-enforced: ${config.id}`)
  } else {
    config = await stripe.billingPortal.configurations.create({
      name: 'Hudo billing delegate (invoices + payment method only)',
      features: DELEGATE_PORTAL_FEATURES,
      metadata: { hudo_role: DELEGATE_PORTAL_ROLE },
    })
    console.log(`  [+] Delegate portal configuration created: ${config.id}`)
  }
  const f = config.features
  if (config.is_default) {
    throw new Error(`Delegate portal configuration ${config.id} is the account default; owners would get it`)
  }
  if (f.subscription_cancel.enabled || f.subscription_update.enabled || f.customer_update.enabled) {
    throw new Error(`Delegate portal configuration ${config.id} still allows cancel/plan/customer edits`)
  }
  return config.id
}

async function ensurePortalConfigs(stripe: Stripe): Promise<string> {
  console.log('── Customer portal configurations ────────────────────────────────')
  await ensureOwnerDefaultPortalConfig(stripe)
  const delegateId = await ensureDelegatePortalConfig(stripe)
  console.log(`  Set STRIPE_PORTAL_CONFIG_DELEGATE=${delegateId} for this Stripe mode.`)
  console.log()
  return delegateId
}

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
  console.log(`  Key: ${isLive ? 'live' : 'test'} secret (value hidden)`)
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

  if (process.argv.includes('--portal-only')) {
    await ensurePortalConfigs(stripe)
    return
  }

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

  const delegatePortalId = await ensurePortalConfigs(stripe)

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`Products  — created: ${summary.products.created.length}, updated: ${summary.products.updated.length}, skipped: ${summary.products.skipped.length}`)
  console.log(`Prices    — created: ${summary.prices.created.length}, skipped: ${summary.prices.skipped.length}`)
  console.log(`Archived  — ${summary.archived.length} old price(s)`)
  console.log(`Coupons   — created: ${summary.coupons.created.length}, skipped: ${summary.coupons.skipped.length}`)
  console.log(`Portal    — delegate configuration: ${delegatePortalId}`)
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
