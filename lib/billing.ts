/**
 * lib/billing.ts — Stripe billing sync helpers for Hudo.
 *
 * Sync contract:
 *   checkout.session.completed → write stripe_customer_id, stripe_subscription_id, plan, status
 *                                 onto the agency resolved via metadata.agency_id (set at checkout creation).
 *   customer.subscription.updated  → update plan, status, stripe_subscription_id for the agency
 *                                     resolved via stripe_customer_id.
 *   customer.subscription.deleted  → set status = 'canceled', plan = 'freemium'.
 *   invoice.payment_failed         → set status = 'past_due'.
 *
 * Renewal-date gap: the agencies table has no subscription_renewal_date / current_period_end
 * column (verified against all migrations). Renewal date sync is omitted; add migration
 * 0021_agencies_subscription_renewal_date.sql before billing goes live in production.
 *
 * Status mapping: agencies.subscription_status CHECK enforces (active|trialing|past_due|canceled).
 * Stripe also emits unpaid, incomplete, incomplete_expired, paused — these are mapped below.
 */

import type Stripe from 'stripe'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getPlanFromPriceId } from '@/lib/stripe'

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
// Event handlers
// ---------------------------------------------------------------------------

/**
 * checkout.session.completed
 *
 * Resolves the agency via `session.metadata.agency_id` (the checkout caller must
 * set `metadata: { agency_id }` when creating the Stripe Checkout Session).
 * Writes: stripe_customer_id, stripe_subscription_id, plan, subscription_status.
 */
export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  deps?: BillingDeps
): Promise<void> {
  const admin = deps?.admin ?? createAdminClient()

  const agencyId = session.metadata?.agency_id
  if (!agencyId) {
    console.error('[billing:checkout] Missing metadata.agency_id — cannot resolve agency')
    return
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
  // If not expanded, falls back to 'freemium'; the subsequent subscription.updated
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

  const { error } = await admin
    .from('agencies')
    .update({
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      plan,
      subscription_status: 'active',
    })
    .eq('id', agencyId)

  if (error) {
    console.error('[billing:checkout] Failed to update agency', { agencyId, error })
    throw error
  }
}

/**
 * customer.subscription.updated
 *
 * Resolves the agency via stripe_customer_id.
 * Writes: plan, subscription_status, stripe_subscription_id.
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

  const { error } = await admin
    .from('agencies')
    .update({
      stripe_subscription_id: subscription.id,
      plan,
      subscription_status: status,
    })
    .eq('stripe_customer_id', customerId)

  if (error) {
    console.error('[billing:subscription.updated] Failed to update agency', {
      customerId,
      error,
    })
    throw error
  }
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

  const { error } = await admin
    .from('agencies')
    .update({
      subscription_status: 'canceled',
      plan: 'freemium',
    })
    .eq('stripe_customer_id', customerId)

  if (error) {
    console.error('[billing:subscription.deleted] Failed to update agency', {
      customerId,
      error,
    })
    throw error
  }
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

  const { error } = await admin
    .from('agencies')
    .update({ subscription_status: 'past_due' })
    .eq('stripe_customer_id', customerId)

  if (error) {
    console.error('[billing:invoice.payment_failed] Failed to update agency', {
      customerId,
      error,
    })
    throw error
  }
}
