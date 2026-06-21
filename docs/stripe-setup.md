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

### Current catalogue (resolved by `lookup_key`)

The app **never** hardcodes price IDs — it resolves the Stripe price at runtime by `lookup_key` (`resolvePriceId` in `lib/stripe.ts`), and the canonical numbers live in `lib/plans.ts`. To find the actual price IDs in a given mode, run `verify-plan-consistency.ts` or look up the lookup_key in the Stripe dashboard.

| Plan | Monthly `lookup_key` | Monthly | Annual `lookup_key` | Annual | Agent seats | Talent | Storage |
|---|---|---|---|---|---|---|---|
| Freemium | — (no Stripe price) | £0 | — | £0 | 1 | Unlimited | 10 GB |
| Starter | `starter_monthly` | £15/mo | `starter_annual` | £150/yr | 3 | Unlimited | 100 GB |
| Studio | `studio_monthly` | £39/mo | `studio_annual` | £390/yr | 8 | Unlimited | 500 GB |
| Agency Pro | `agency_pro_monthly` | £89/mo | `agency_pro_annual` | £890/yr | 20 | Unlimited | 1 TB |

To (re-)create/refresh this catalogue (mode chosen by the `STRIPE_SECRET_KEY` prefix; idempotent; archives any superseded prices; live mode requires a typed `YES` confirmation): `node --import tsx --env-file=<env> scripts/setup-stripe.ts`. Verify code↔Stripe consistency afterwards: `node --import tsx --env-file=<env> scripts/verify-plan-consistency.ts`.

### Legacy prices (archived 2026-06-18 — grandfathered, do not delete)

These are the original £49/£149/£349 prices created 2026-06-17. The pricing rebuild **archived** them (`active: false`) — existing subscribers stay on them and are mapped back to their plan via `LEGACY_PRICE_ID_TO_PLAN` in `lib/stripe.ts` (their old prices carry no `lookup_key`). They are never deleted and never offered at checkout.

| Plan | Live Price ID | Test Price ID | Amount |
|---|---|---|---|
| Freemium | `price_1Tj62qACrrYvovCOdEQ8Na6A` | `price_1Tj85HPE8Ih3LOAAztAGBtDJ` | £0/mo |
| Starter | `price_1Tj62rACrrYvovCO7KSCJoNG` | `price_1Tj85JPE8Ih3LOAA2sQEqx1D` | £49/mo |
| Studio | `price_1Tj62rACrrYvovCOJSq5bDTe` | `price_1Tj85KPE8Ih3LOAA3nTZcplc` | £149/mo |
| Agency Pro | `price_1Tj62sACrrYvovCOYFJ6Afa4` | `price_1Tj85LPE8Ih3LOAAwghsraL5` | £349/mo |

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
import { getStripe, getStripePriceId, FOUNDING_COUPON } from '@/lib/stripe'

// Always call getStripe() inside a function — never at module scope
export async function createCheckout(plan: StripePlan) {
  const stripe = getStripe()
  return stripe.checkout.sessions.create({
    line_items: [{ price: getStripePriceId(plan), quantity: 1 }],
    discounts: [{ coupon: FOUNDING_COUPON }],
    // ...
  })
}
```
