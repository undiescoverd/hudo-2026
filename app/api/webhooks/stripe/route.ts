/**
 * POST /api/webhooks/stripe
 *
 * Stripe webhook endpoint. Verifies signature, dispatches events, and syncs
 * subscription state to the agencies table.
 *
 * Idempotency: uses Redis SET NX keyed on the Stripe event ID with a 24-hour TTL.
 * The key is written AFTER successful processing so a failed process + Stripe retry
 * will re-run, not skip. lib/redis.ts throws at module scope if env is absent, so
 * it is dynamically imported only when needed (mirrors lib/rate-limit.ts pattern).
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

async function isAlreadyProcessed(eventId: string): Promise<boolean> {
  try {
    const { redis } = await import('@/lib/redis')
    // SET NX returns 1 if the key was set (first time = not yet processed),
    // null if the key already existed (already processed).
    const key = `stripe:processed:${eventId}`
    const result = await redis.set(key, '1', { nx: true, ex: IDEMPOTENCY_TTL_SECONDS })
    // result === null means key already existed → event already processed
    return result === null
  } catch (err) {
    // Redis unavailable — log and fall through (process the event; better than silently skipping).
    console.error('[webhooks/stripe] Redis idempotency check failed; processing anyway:', err)
    return false
  }
}

async function clearIdempotencyKey(eventId: string): Promise<void> {
  try {
    const { redis } = await import('@/lib/redis')
    await redis.del(`stripe:processed:${eventId}`)
  } catch {
    // Non-fatal; best-effort rollback if processing fails
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

  // AC4: Idempotency — set key BEFORE processing to claim it, clear on failure.
  // Note: SET NX is atomic. Concurrent duplicate events: one wins, one skips (200).
  const alreadyProcessed = await isAlreadyProcessed(event.id)
  if (alreadyProcessed) {
    return NextResponse.json({ received: true, skipped: true })
  }

  // AC3: Dispatch event handlers.
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session)
        break

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
    // Processing failed — clear the idempotency key so Stripe's retry can re-run.
    console.error(`[webhooks/stripe] Handler failed for event ${event.id} (${event.type}):`, err)
    await clearIdempotencyKey(event.id)
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }

  // AC6: 200 for successfully processed and idempotently-skipped events.
  return NextResponse.json({ received: true })
}
