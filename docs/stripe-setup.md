# Stripe Setup

## Environment variables

| Variable | Where | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | Server only | `sk_live_…` from Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Server only | `whsec_…` from Stripe Dashboard → Developers → Webhooks |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client + server | `pk_live_…` from same API keys page |
| `NEXT_PUBLIC_BILLING_ENABLED` | Client + server | `true` to enable billing; `false` (default) to hide all billing UI |

Add to `.env.local` (dev), `.env.staging` (staging), and Vercel env (preview + production).

## Feature flag

All billing functionality is gated by `NEXT_PUBLIC_BILLING_ENABLED`. When `false`:
- Upgrade buttons and billing pages are hidden
- Checkout API routes return 403
- Webhook handler still accepts events but skips processing

Set to `true` only when you have:
1. Stripe keys populated in the relevant env
2. UK VAT configured in Stripe Tax (Dashboard → Billing → Tax)
3. Webhook endpoint registered (see below)

## Products & Prices

### Live mode (created 2026-06-17)

| Plan | Product ID | Price ID | Amount |
|---|---|---|---|
| Freemium | `prod_UiX6D3t5UhEVfH` | `price_1Tj62qACrrYvovCOdEQ8Na6A` | £0/mo |
| Starter | `prod_UiX6DDbPQMJDtZ` | `price_1Tj62rACrrYvovCO7KSCJoNG` | £49/mo |
| Studio | `prod_UiX6HVemJKoE18` | `price_1Tj62rACrrYvovCOJSq5bDTe` | £149/mo |
| Agency Pro | `prod_UiX6dbqqLWAYE2` | `price_1Tj62sACrrYvovCOYFJ6Afa4` | £349/mo |

### Test mode (created 2026-06-17)

| Plan | Product ID | Price ID | Amount |
|---|---|---|---|
| Freemium | `prod_UiZD6zPtLWSZWw` | `price_1Tj85HPE8Ih3LOAAztAGBtDJ` | £0/mo |
| Starter | `prod_UiZDph8eKoBqKt` | `price_1Tj85JPE8Ih3LOAA2sQEqx1D` | £49/mo |
| Studio | `prod_UiZDAGVOImSDEZ` | `price_1Tj85KPE8Ih3LOAA3nTZcplc` | £149/mo |
| Agency Pro | `prod_UiZDU8ILLkJ22m` | `price_1Tj85LPE8Ih3LOAAwghsraL5` | £349/mo |

To re-bootstrap test mode resources: `node --env-file=.env.local scripts/setup-stripe-test.mjs` (idempotent).

Coupon: `FOUNDING_50` — 50% off for 12 months, exists in both modes (applied at checkout when `agencies.is_founding_member = true`)

## Stripe Tax (manual — Dashboard only)

1. Stripe Dashboard → Billing → Tax → Enable Stripe Tax
2. Add a registration: United Kingdom, 20% VAT
3. Set price `tax_behavior` to `exclusive` (VAT shown separately on invoices)

## Webhook endpoint (manual — Dashboard only)

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://your-vercel-url.vercel.app/api/webhooks/stripe`
3. Events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`

## Using the feature flag in code

```ts
import { isBillingEnabled } from '@/lib/feature-flags'

// Server Component / API route
if (!isBillingEnabled()) {
  return <UpgradeComingSoon />
}

// In an API route
if (!isBillingEnabled()) {
  return NextResponse.json({ error: 'Billing not enabled' }, { status: 403 })
}
```

## Using the Stripe client

```ts
import { getStripe, STRIPE_PRICES, FOUNDING_COUPON } from '@/lib/stripe'

// Always call getStripe() inside a function — never at module scope
const stripe = getStripe()
const session = await stripe.checkout.sessions.create({ ... })
```
