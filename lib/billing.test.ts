/**
 * lib/billing.test.ts — Unit tests for Stripe billing sync helpers.
 *
 * All Supabase calls are mocked via a lightweight stub admin client.
 * No network calls; no Redis.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

// ---------------------------------------------------------------------------
// Minimal SupabaseClient stub
// ---------------------------------------------------------------------------

type UpdateCapture = {
  table: string
  values: Record<string, unknown>
  filter: Record<string, unknown>
}

function makeAdminStub(error: unknown = null) {
  const captures: UpdateCapture[] = []

  const stub = {
    _captures: captures,
    from(table: string) {
      return {
        update(values: Record<string, unknown>) {
          return {
            eq(col: string, val: unknown) {
              captures.push({ table, values, filter: { [col]: val } })
              return Promise.resolve({ error })
            },
          }
        },
      }
    },
  }

  return stub as unknown as SupabaseClient & {
    _captures: UpdateCapture[]
  }
}

// ---------------------------------------------------------------------------
// Stripe object factories (minimal)
// ---------------------------------------------------------------------------

function makeCheckoutSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_test_123',
    customer: 'cus_test_abc',
    subscription: 'sub_test_xyz',
    metadata: { agency_id: 'agency-uuid-1' },
    line_items: {
      data: [{ price: { id: 'price_1Tj85JPE8Ih3LOAA2sQEqx1D' } }], // test starter price
    },
    ...overrides,
  } as unknown as Stripe.Checkout.Session
}

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_test_xyz',
    customer: 'cus_test_abc',
    status: 'active',
    items: {
      data: [{ price: { id: 'price_1Tj85KPE8Ih3LOAA3nTZcplc' } }], // test studio price
    },
    ...overrides,
  } as unknown as Stripe.Subscription
}

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'in_test_123',
    customer: 'cus_test_abc',
    ...overrides,
  } as unknown as Stripe.Invoice
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('billing helpers', () => {
  describe('handleCheckoutSessionCompleted', () => {
    it('writes stripe_customer_id, stripe_subscription_id, plan, and subscription_status to the agency', async () => {
      const { handleCheckoutSessionCompleted } = await import('./billing')
      const admin = makeAdminStub()
      const session = makeCheckoutSession()

      await handleCheckoutSessionCompleted(session, { admin })

      assert.equal(admin._captures.length, 1)
      const cap = admin._captures[0]
      assert.equal(cap.table, 'agencies')
      assert.equal(cap.values.stripe_customer_id, 'cus_test_abc')
      assert.equal(cap.values.stripe_subscription_id, 'sub_test_xyz')
      assert.equal(cap.values.plan, 'starter')
      assert.equal(cap.values.subscription_status, 'active')
      assert.deepEqual(cap.filter, { id: 'agency-uuid-1' })
    })

    it('skips and logs when metadata.agency_id is missing', async () => {
      const { handleCheckoutSessionCompleted } = await import('./billing')
      const admin = makeAdminStub()
      const session = makeCheckoutSession({ metadata: {} })

      await handleCheckoutSessionCompleted(session, { admin })

      // No DB write attempted
      assert.equal(admin._captures.length, 0)
    })

    it('throws when admin update returns error', async () => {
      const { handleCheckoutSessionCompleted } = await import('./billing')
      const dbError = { message: 'update failed', code: 'PGRST301' }
      const admin = makeAdminStub(dbError)
      const session = makeCheckoutSession()

      await assert.rejects(
        () => handleCheckoutSessionCompleted(session, { admin }),
        (err) => err === dbError
      )
    })
  })

  describe('handleSubscriptionUpdated', () => {
    it('writes plan, subscription_status, stripe_subscription_id keyed by stripe_customer_id', async () => {
      const { handleSubscriptionUpdated } = await import('./billing')
      const admin = makeAdminStub()
      const subscription = makeSubscription()

      await handleSubscriptionUpdated(subscription, { admin })

      assert.equal(admin._captures.length, 1)
      const cap = admin._captures[0]
      assert.equal(cap.table, 'agencies')
      assert.equal(cap.values.plan, 'studio')
      assert.equal(cap.values.subscription_status, 'active')
      assert.equal(cap.values.stripe_subscription_id, 'sub_test_xyz')
      assert.deepEqual(cap.filter, { stripe_customer_id: 'cus_test_abc' })
    })

    it('maps Stripe past_due status to DB past_due', async () => {
      const { handleSubscriptionUpdated } = await import('./billing')
      const admin = makeAdminStub()
      const subscription = makeSubscription({ status: 'past_due' })

      await handleSubscriptionUpdated(subscription, { admin })

      assert.equal(admin._captures[0].values.subscription_status, 'past_due')
    })

    it('maps Stripe unpaid status to DB past_due (CHECK constraint safe)', async () => {
      const { handleSubscriptionUpdated } = await import('./billing')
      const admin = makeAdminStub()
      const subscription = makeSubscription({ status: 'unpaid' })

      await handleSubscriptionUpdated(subscription, { admin })

      assert.equal(admin._captures[0].values.subscription_status, 'past_due')
    })

    it('maps Stripe paused status to DB past_due (CHECK constraint safe)', async () => {
      const { handleSubscriptionUpdated } = await import('./billing')
      const admin = makeAdminStub()
      const subscription = makeSubscription({ status: 'paused' })

      await handleSubscriptionUpdated(subscription, { admin })

      assert.equal(admin._captures[0].values.subscription_status, 'past_due')
    })

    it('maps Stripe incomplete status to DB past_due (CHECK constraint safe)', async () => {
      const { handleSubscriptionUpdated } = await import('./billing')
      const admin = makeAdminStub()
      const subscription = makeSubscription({ status: 'incomplete' })

      await handleSubscriptionUpdated(subscription, { admin })

      assert.equal(admin._captures[0].values.subscription_status, 'past_due')
    })

    it('maps unknown status to DB past_due (safe fallback)', async () => {
      const { handleSubscriptionUpdated } = await import('./billing')
      const admin = makeAdminStub()
      const subscription = makeSubscription({ status: 'some_future_status' })

      await handleSubscriptionUpdated(subscription, { admin })

      assert.equal(admin._captures[0].values.subscription_status, 'past_due')
    })
  })

  describe('handleSubscriptionDeleted', () => {
    it('sets status = canceled and plan = freemium', async () => {
      const { handleSubscriptionDeleted } = await import('./billing')
      const admin = makeAdminStub()
      const subscription = makeSubscription({ status: 'canceled' })

      await handleSubscriptionDeleted(subscription, { admin })

      assert.equal(admin._captures.length, 1)
      const cap = admin._captures[0]
      assert.equal(cap.table, 'agencies')
      assert.equal(cap.values.subscription_status, 'canceled')
      assert.equal(cap.values.plan, 'freemium')
      assert.deepEqual(cap.filter, { stripe_customer_id: 'cus_test_abc' })
    })
  })

  describe('handleInvoicePaymentFailed', () => {
    it('sets subscription_status = past_due', async () => {
      const { handleInvoicePaymentFailed } = await import('./billing')
      const admin = makeAdminStub()
      const invoice = makeInvoice()

      await handleInvoicePaymentFailed(invoice, { admin })

      assert.equal(admin._captures.length, 1)
      const cap = admin._captures[0]
      assert.equal(cap.table, 'agencies')
      assert.equal(cap.values.subscription_status, 'past_due')
      assert.deepEqual(cap.filter, { stripe_customer_id: 'cus_test_abc' })
    })

    it('skips and logs when invoice has no customer', async () => {
      const { handleInvoicePaymentFailed } = await import('./billing')
      const admin = makeAdminStub()
      const invoice = makeInvoice({ customer: null })

      await handleInvoicePaymentFailed(invoice, { admin })

      assert.equal(admin._captures.length, 0)
    })
  })
})
