/**
 * Creates all Stripe products, prices, and coupons in TEST mode.
 * Run with: node --env-file=.env.local scripts/setup-stripe-test.mjs
 *
 * Requires STRIPE_SECRET_KEY=sk_test_... in your env.
 * Safe to re-run — checks for existing resources before creating.
 */

import Stripe from 'stripe'

const key = process.env.STRIPE_SECRET_KEY
if (!key) {
  console.error('STRIPE_SECRET_KEY is not set')
  process.exit(1)
}
if (!key.startsWith('sk_test_')) {
  console.error(`Expected a test key (sk_test_…) but got: ${key.slice(0, 12)}…`)
  console.error('Switch to your test key before running this script.')
  process.exit(1)
}

const stripe = new Stripe(key, { apiVersion: '2026-05-27.dahlia' })

const PLANS = [
  { name: 'Freemium',   plan: 'freemium',   amount: 0,     description: '1 agent, 5 talent, 5GB storage',                  agents: '1',         talent: '5',         storage_gb: '5' },
  { name: 'Starter',    plan: 'starter',    amount: 4900,  description: '5 agents, 50 talent, 50GB storage',               agents: '5',         talent: '50',        storage_gb: '50' },
  { name: 'Studio',     plan: 'studio',     amount: 14900, description: '15 agents, 200 talent, 200GB storage',            agents: '15',        talent: '200',       storage_gb: '200' },
  { name: 'Agency Pro', plan: 'agency_pro', amount: 34900, description: 'Unlimited agents, unlimited talent, 1TB storage', agents: 'unlimited', talent: 'unlimited', storage_gb: '1000' },
]

async function findExisting(list, name) {
  for await (const item of list) {
    if (item.name === name) return item
  }
  return null
}

console.log('Setting up Stripe test mode resources…\n')

const results = {}

for (const plan of PLANS) {
  // Product
  let product = await findExisting(stripe.products.list({ limit: 100 }), plan.name)
  if (product) {
    console.log(`  [skip] Product "${plan.name}" already exists: ${product.id}`)
  } else {
    product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: { plan: plan.plan, agents: plan.agents, talent: plan.talent, storage_gb: plan.storage_gb },
    })
    console.log(`  [+] Product "${plan.name}": ${product.id}`)
  }

  // Price
  const existingPrices = await stripe.prices.list({ product: product.id, limit: 10 })
  let price = existingPrices.data.find(p => p.unit_amount === plan.amount && p.recurring?.interval === 'month')
  if (price) {
    console.log(`  [skip] Price for "${plan.name}" already exists: ${price.id}`)
  } else {
    price = await stripe.prices.create({
      product: product.id,
      currency: 'gbp',
      unit_amount: plan.amount,
      recurring: { interval: 'month' },
      nickname: `${plan.name} Monthly`,
    })
    console.log(`  [+] Price for "${plan.name}": ${price.id}`)
  }

  results[plan.plan] = { product: product.id, price: price.id }
  console.log()
}

// Coupon
let coupon = null
try {
  coupon = await stripe.coupons.retrieve('FOUNDING_50')
  console.log(`  [skip] Coupon FOUNDING_50 already exists`)
} catch {
  coupon = await stripe.coupons.create({
    id: 'FOUNDING_50',
    name: 'Founding Member — 50% off for 12 months',
    percent_off: 50,
    duration: 'repeating',
    duration_in_months: 12,
    currency: 'gbp',
  })
  console.log(`  [+] Coupon FOUNDING_50 created`)
}

console.log('\n✓ Done. Add these to lib/stripe.ts under STRIPE_PRICES:\n')
for (const [plan, ids] of Object.entries(results)) {
  console.log(`  ${plan}: '${ids.price}',`)
}
console.log('\nUpdate lib/stripe.ts with the test price IDs above.')
console.log('Store live price IDs separately (already created in live mode).')
