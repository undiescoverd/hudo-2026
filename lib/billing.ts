/**
 * lib/billing.ts — Stripe billing sync helpers for Hudo.
 *
 * Sync contract:
 *   checkout.session.completed → write stripe_customer_id, stripe_subscription_id, plan, status,
 *                                 current_period_end onto the agency resolved via metadata.agency_id
 *                                 (set at checkout creation).
 *   customer.subscription.created/updated → update plan, status, stripe_subscription_id,
 *                                            current_period_end for the agency resolved via
 *                                            stripe_customer_id.
 *   customer.subscription.deleted  → set status = 'canceled', plan = 'freemium'.
 *   invoice.payment_failed         → set status = 'past_due'.
 *
 * Status mapping: agencies.subscription_status CHECK enforces (active|trialing|past_due|canceled).
 * Stripe also emits unpaid, incomplete, incomplete_expired, paused — these are mapped below.
 *
 * Zero-row safety: all UPDATE handlers call .select('id', {count:'exact',head:true}) after the
 * write and throw if count === 0. This causes the route to return 500 so Stripe retries.
 * Out-of-order delivery (e.g. subscription.updated before checkout wrote stripe_customer_id)
 * is therefore handled by Stripe retry rather than silently swallowed.
 *
 * current_period_end: read from subscription.items.data[0].current_period_end (UNIX seconds;
 * moved off Subscription top-level in Stripe SDK v17+ / API 2026-05-27 "dahlia").
 */

import type Stripe from 'stripe'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getPlanFromPriceId } from '@/lib/stripe'
import { getPlanStorageLimitBytes } from '@/lib/plan-gates'

// ---------------------------------------------------------------------------
// Admin client factory (service-role — bypasses RLS for billing writes)
// ---------------------------------------------------------------------------

function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[billing] Missing Supabase env vars')
  return createClient(url, key)
}

// Injected admin client for testing; production default via factory above.
export type BillingDeps = {
  admin?: SupabaseClient
}

// ---------------------------------------------------------------------------
// Stripe status → DB CHECK-constraint-safe value
// ---------------------------------------------------------------------------

type DbSubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled'

function mapStripeStatus(stripeStatus: string): DbSubscriptionStatus {
  switch (stripeStatus) {
    case 'active':
      return 'active'
    case 'trialing':
      return 'trialing'
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
      return 'past_due'
    case 'canceled':
      return 'canceled'
    default:
      // Unknown future status — degrade gracefully to past_due (triggers follow-up)
      return 'past_due'
  }
}

// ---------------------------------------------------------------------------
// Shared update + zero-row guard
// ---------------------------------------------------------------------------

/**
 * Applies an absolute UPDATE to the agencies table and verifies a row matched.
 *
 * Two round-trips by design (do NOT collapse into `.update().select(count)`):
 *   1. UPDATE agencies SET <payload> WHERE <column> = <value>
 *   2. SELECT count WHERE <column> = <value>  — verify a row actually matched
 *
 * Both errors are re-thrown as the raw error object (not wrapped) and a zero-row
 * match throws `zeroRowMessage`, so the webhook route returns 500 and Stripe retries.
 */
async function updateAgencyOrThrow(
  admin: SupabaseClient,
  params: {
    column: 'id' | 'stripe_customer_id'
    value: string
    payload: Record<string, unknown>
    logPrefix: string
    zeroRowMessage: string
  }
): Promise<void> {
  const { column, value, payload, logPrefix, zeroRowMessage } = params

  const { error } = await admin.from('agencies').update(payload).eq(column, value)
  if (error) {
    console.error(`${logPrefix} Failed to update agency`, { [column]: value, error })
    throw error
  }

  const { count, error: countError } = await admin
    .from('agencies')
    .select('id', { count: 'exact', head: true })
    .eq(column, value)
  if (countError) {
    console.error(`${logPrefix} Count check failed`, { [column]: value, countError })
    throw countError
  }

  if (!count || count === 0) {
    throw new Error(zeroRowMessage)
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * checkout.session.completed
 *
 * Resolves the agency via `session.metadata.agency_id` (the checkout caller must
 * set `metadata: { agency_id }` when creating the Stripe Checkout Session).
 * Writes: stripe_customer_id, stripe_subscription_id, plan, subscription_status.
 * current_period_end is written by the subsequent subscription.created/updated event
 * (checkout.session doesn't reliably carry the subscription period end inline).
 */
export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  deps?: BillingDeps
): Promise<void> {
  const admin = deps?.admin ?? createAdminClient()

  const agencyId = session.metadata?.agency_id
  if (!agencyId) {
    // Throw so route returns 500 and Stripe retries — a missing agency_id on a
    // paid checkout is a critical data-loss scenario, not a graceful skip.
    throw new Error(
      `[billing:checkout] Missing metadata.agency_id — cannot resolve agency (session ${session.id})`
    )
  }

  const customerId =
    typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null)
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : (session.subscription?.id ?? null)

  if (!customerId || !subscriptionId) {
    console.error('[billing:checkout] Missing customer or subscription on completed session', {
      sessionId: session.id,
    })
    return
  }

  // Determine plan from line_items if already expanded on the session object.
  // If not expanded, falls back to 'freemium'; the subsequent subscription.created/updated
  // event will write the correct plan regardless.
  let plan = 'freemium'
  const lineItems = (
    session as Stripe.Checkout.Session & {
      line_items?: { data: { price?: Stripe.Price | null }[] }
    }
  ).line_items
  const priceId = lineItems?.data?.[0]?.price?.id
  if (priceId) {
    plan = getPlanFromPriceId(priceId)
  }

  await updateAgencyOrThrow(admin, {
    column: 'id',
    value: agencyId,
    payload: {
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      plan,
      subscription_status: 'active',
      storage_limit_bytes: getPlanStorageLimitBytes(plan),
      // Clear any grace period from a prior past_due cycle on successful checkout.
      grace_period_ends_at: null,
    },
    logPrefix: '[billing:checkout]',
    zeroRowMessage: `[billing:checkout] Zero rows updated for agency ${agencyId} — Stripe retry`,
  })
}

/**
 * customer.subscription.created / customer.subscription.updated
 *
 * Both events carry the full Subscription object. Resolves the agency via
 * stripe_customer_id. Writes: plan, subscription_status, stripe_subscription_id,
 * current_period_end.
 *
 * Note: the Stripe Dashboard webhook endpoint must also be subscribed to
 * customer.subscription.created (not just customer.subscription.updated).
 *
 * current_period_end is read from subscription.items.data[0].current_period_end
 * (UNIX seconds). It was moved off Subscription top-level in Stripe SDK v17+ /
 * API version 2026-05-27.dahlia — accessing it at the item level is correct for
 * this pinned API version.
 */
export async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
  deps?: BillingDeps
): Promise<void> {
  const admin = deps?.admin ?? createAdminClient()

  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id

  const priceId = subscription.items.data[0]?.price?.id
  const plan = priceId ? getPlanFromPriceId(priceId) : 'freemium'
  const status = mapStripeStatus(subscription.status)

  // current_period_end lives on the SubscriptionItem in API 2026-05-27.dahlia+
  const periodEndUnix = subscription.items.data[0]?.current_period_end
  const currentPeriodEnd =
    typeof periodEndUnix === 'number' ? new Date(periodEndUnix * 1000).toISOString() : undefined

  const updatePayload: Record<string, unknown> = {
    stripe_subscription_id: subscription.id,
    plan,
    subscription_status: status,
    storage_limit_bytes: getPlanStorageLimitBytes(plan),
  }
  if (currentPeriodEnd !== undefined) {
    updatePayload.current_period_end = currentPeriodEnd
  }
  // Clear any grace period when the subscription recovers to active or trialing.
  if (status === 'active' || status === 'trialing') {
    updatePayload.grace_period_ends_at = null
  }

  // Zero-row guard (inside the helper): subscription.updated can arrive before
  // checkout.session.completed has written stripe_customer_id. Throwing lets Stripe retry.
  await updateAgencyOrThrow(admin, {
    column: 'stripe_customer_id',
    value: customerId,
    payload: updatePayload,
    logPrefix: '[billing:subscription.updated]',
    zeroRowMessage: `[billing:subscription.updated] Zero rows matched for customer ${customerId} — Stripe retry`,
  })
}

/**
 * customer.subscription.deleted
 *
 * Resets the agency to freemium / canceled.
 */
export async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
  deps?: BillingDeps
): Promise<void> {
  const admin = deps?.admin ?? createAdminClient()

  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id

  await updateAgencyOrThrow(admin, {
    column: 'stripe_customer_id',
    value: customerId,
    payload: {
      subscription_status: 'canceled',
      plan: 'freemium',
      // Reset the storage cap to freemium on cancellation — otherwise a downgraded
      // agency keeps its paid storage limit indefinitely (and the grace gate never
      // fires for 'canceled', only 'past_due').
      storage_limit_bytes: getPlanStorageLimitBytes('freemium'),
    },
    logPrefix: '[billing:subscription.deleted]',
    zeroRowMessage: `[billing:subscription.deleted] Zero rows matched for customer ${customerId} — Stripe retry`,
  })
}

/**
 * invoice.payment_failed
 *
 * Marks the subscription as past_due.
 */
export async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  deps?: BillingDeps
): Promise<void> {
  const admin = deps?.admin ?? createAdminClient()

  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer?.id ?? null)

  if (!customerId) {
    console.error('[billing:invoice.payment_failed] No customer on invoice', {
      invoiceId: invoice.id,
    })
    return
  }

  // Derive the base timestamp from the invoice (UNIX seconds) if available;
  // fall back to wall-clock time. Grace period = 7 days from the failed invoice.
  const baseMs = typeof invoice.created === 'number' ? invoice.created * 1000 : Date.now()
  const gracePeriodEndsAt = new Date(baseMs + 7 * 24 * 60 * 60 * 1000).toISOString()

  await updateAgencyOrThrow(admin, {
    column: 'stripe_customer_id',
    value: customerId,
    payload: { subscription_status: 'past_due', grace_period_ends_at: gracePeriodEndsAt },
    logPrefix: '[billing:invoice.payment_failed]',
    zeroRowMessage: `[billing:invoice.payment_failed] Zero rows matched for customer ${customerId} — Stripe retry`,
  })
}
