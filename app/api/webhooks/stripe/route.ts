/**
 * POST /api/webhooks/stripe
 *
 * Stripe webhook endpoint. Verifies signature, dispatches events, and syncs
 * subscription state to the agencies table.
 *
 * Idempotency: uses Redis keyed on the Stripe event ID with a 24-hour TTL.
 * - Pre-check: GET/EXISTS to skip obvious duplicates early (non-mutating read).
 * - Post-success write: SET NX is written ONLY after the handler completes
 *   successfully. If the handler throws, no claim is written — Stripe's retry
 *   will re-run the event on the next attempt.
 * - Concurrent duplicates: both may slip through the pre-check before either
 *   writes the post-success claim. All four handlers are idempotent absolute
 *   UPDATEs, so a double-write is harmless. Any future non-idempotent handler
 *   must be aware of this invariant.
 * - Redis unavailable on post-success write: log + return 200 (event was
 *   processed; Stripe may retry but the duplicate UPDATE is safe).
 *
 * Security:
 * - Raw request body read via `request.text()` — never JSON-parsed before sig check.
 * - Stripe-Signature header verified via Stripe SDK constructEvent.
 * - STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET never leave server code.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import {
  handleCheckoutSessionCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaymentFailed,
} from '@/lib/billing'
import type Stripe from 'stripe'

// Force Node.js runtime — stripe.webhooks.constructEvent uses Node crypto APIs.
export const runtime = 'nodejs'

// Idempotency TTL: 24 hours (Stripe retries within ~72h; 24h is a safe dedup window).
const IDEMPOTENCY_TTL_SECONDS = 86_400

/**
 * Non-mutating pre-check: returns true if the event ID key already exists in Redis.
 * Does NOT write anything. Used to short-circuit obvious duplicates before dispatch.
 */
async function isAlreadyProcessed(eventId: string): Promise<boolean> {
  try {
    const { redis } = await import('@/lib/redis')
    const key = `stripe:processed:${eventId}`
    const existing = await redis.get(key)
    return existing !== null
  } catch (err) {
    // Redis unavailable — log and fall through (process the event; better than skipping).
    console.error('[webhooks/stripe] Redis pre-check failed; processing anyway:', err)
    return false
  }
}

/**
 * Post-success claim: SET NX written ONLY after the handler completes.
 * Redis unavailable here → log and return 200 (event was processed; Stripe may
 * retry but the duplicate UPDATE in all handlers is safe).
 *
 * Returns true if Redis was written (or unavailable), false if key already existed
 * (unlikely race — concurrent duplicate slipped through pre-check and won the write).
 */
async function claimProcessed(eventId: string): Promise<void> {
  try {
    const { redis } = await import('@/lib/redis')
    const key = `stripe:processed:${eventId}`
    await redis.set(key, '1', { nx: true, ex: IDEMPOTENCY_TTL_SECONDS })
    // If SET NX returned null (key already existed from a concurrent duplicate),
    // that's fine — the duplicate also completed successfully.
  } catch (err) {
    // Redis unavailable — log but do NOT return 500. The event was processed;
    // Stripe may retry and the duplicate UPDATE is safe (idempotent absolute writes).
    console.error(
      '[webhooks/stripe] Redis post-success claim failed (event processed, may retry):',
      err
    )
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // AC1: Read raw body — must NOT be JSON-parsed before signature verification.
  const rawBody = await request.text()

  const sigHeader = request.headers.get('stripe-signature')
  if (!sigHeader) {
    return NextResponse.json({ error: 'Missing Stripe-Signature header' }, { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[webhooks/stripe] STRIPE_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  // AC2: Signature validation — rejects tampered or replay-without-valid-sig requests.
  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sigHeader, webhookSecret)
  } catch (err) {
    console.error('[webhooks/stripe] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // AC4: Idempotency pre-check (non-mutating read — does not claim the event).
  const alreadyProcessed = await isAlreadyProcessed(event.id)
  if (alreadyProcessed) {
    return NextResponse.json({ received: true, skipped: true })
  }

  // AC3: Dispatch event handlers.
  // On handler throw → return 500 (no idempotency claim written) so Stripe retries.
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session)
        break

      // customer.subscription.created must also be subscribed in the Stripe Dashboard
      // webhook endpoint — new paid subscribers stay 'freemium' without it, because
      // checkout.session.completed doesn't reliably expand line_items.
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
        break

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
        break

      default:
        // Unhandled event types — return 200 so Stripe doesn't retry them.
        break
    }
  } catch (err) {
    // Handler failed — do NOT write idempotency claim so Stripe's retry can re-run.
    console.error(`[webhooks/stripe] Handler failed for event ${event.id} (${event.type}):`, err)
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }

  // AC4: Post-success idempotency claim — written ONLY after successful processing.
  await claimProcessed(event.id)

  // AC6: 200 for successfully processed and idempotently-skipped events.
  return NextResponse.json({ received: true })
}
