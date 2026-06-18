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

type SelectCapture = {
  table: string
  filter: Record<string, unknown>
  count: boolean
}

/**
 * makeAdminStub builds a fake Supabase admin client.
 *
 * @param updateError  - Error to return from .eq() (the update path). null = success.
 * @param rowCount     - Row count returned by the .select({count:'exact',head:true}) check.
 *                       Defaults to 1 (row found). Pass 0 to trigger the zero-row throw.
 * @param selectError  - Error to return from the count-select call. null = success.
 */
function makeAdminStub(
  updateError: unknown = null,
  rowCount: number = 1,
  selectError: unknown = null
) {
  const updateCaptures: UpdateCapture[] = []
  const selectCaptures: SelectCapture[] = []

  const stub = {
    _updateCaptures: updateCaptures,
    _selectCaptures: selectCaptures,
    // Alias for backwards-compat with tests that used _captures
    get _captures() {
      return updateCaptures
    },
    from(table: string) {
      return {
        update(values: Record<string, unknown>) {
          return {
            eq(col: string, val: unknown) {
              updateCaptures.push({ table, values, filter: { [col]: val } })
              // Return a resolved promise — the update is "done"
              return Promise.resolve({ error: updateError })
            },
          }
        },
        select(_columns: string, options?: { count?: string; head?: boolean }) {
          const isCount = options?.count === 'exact' && options?.head === true
          return {
            eq(col: string, val: unknown) {
              selectCaptures.push({ table, filter: { [col]: val }, count: !!isCount })
              return Promise.resolve({ error: selectError, count: rowCount })
            },
          }
        },
      }
    },
  }

  return stub as unknown as SupabaseClient & {
    _captures: UpdateCapture[]
    _updateCaptures: UpdateCapture[]
    _selectCaptures: SelectCapture[]
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
      data: [
        {
          price: { id: 'price_1Tj85KPE8Ih3LOAA3nTZcplc' }, // test studio price
          current_period_end: 1750000000, // Unix seconds
        },
      ],
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

    it('throws when metadata.agency_id is missing (so route returns 500 and Stripe retries)', async () => {
      const { handleCheckoutSessionCompleted } = await import('./billing')
      const admin = makeAdminStub()
      const session = makeCheckoutSession({ metadata: {} })

      // Missing agency_id is now a throw, not a silent return — critical paid checkout data loss
      await assert.rejects(
        () => handleCheckoutSessionCompleted(session, { admin }),
        (err: Error) => err instanceof Error && err.message.includes('Missing metadata.agency_id')
      )
    })

    it('throws when zero rows were updated (agency id not found)', async () => {
      const { handleCheckoutSessionCompleted } = await import('./billing')
      const admin = makeAdminStub(null, 0) // no update error, but count = 0
      const session = makeCheckoutSession()

      await assert.rejects(
        () => handleCheckoutSessionCompleted(session, { admin }),
        (err: Error) => err instanceof Error && err.message.includes('Zero rows updated')
      )
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
    it('writes plan, subscription_status, stripe_subscription_id, current_period_end keyed by stripe_customer_id', async () => {
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

    it('writes current_period_end as ISO string from UNIX timestamp on subscription item', async () => {
      const { handleSubscriptionUpdated } = await import('./billing')
      const admin = makeAdminStub()
      // 1750000000 seconds = specific ISO date
      const subscription = makeSubscription() // includes current_period_end: 1750000000

      await handleSubscriptionUpdated(subscription, { admin })

      const cap = admin._captures[0]
      assert.equal(
        cap.values.current_period_end,
        new Date(1750000000 * 1000).toISOString(),
        'current_period_end should be an ISO string derived from the UNIX timestamp'
      )
    })

    it('omits current_period_end when subscription item has no period end', async () => {
      const { handleSubscriptionUpdated } = await import('./billing')
      const admin = makeAdminStub()
      const subscription = makeSubscription({
        items: {
          data: [
            {
              price: { id: 'price_1Tj85KPE8Ih3LOAA3nTZcplc' },
              // no current_period_end
            },
          ],
        },
      })

      await handleSubscriptionUpdated(subscription, { admin })

      const cap = admin._captures[0]
      assert.equal(
        'current_period_end' in cap.values,
        false,
        'current_period_end should not be written when absent from item'
      )
    })

    it('throws when zero rows matched for stripe_customer_id', async () => {
      const { handleSubscriptionUpdated } = await import('./billing')
      const admin = makeAdminStub(null, 0)
      const subscription = makeSubscription()

      await assert.rejects(
        () => handleSubscriptionUpdated(subscription, { admin }),
        (err: Error) => err instanceof Error && err.message.includes('Zero rows matched')
      )
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

    it('throws when zero rows matched for stripe_customer_id', async () => {
      const { handleSubscriptionDeleted } = await import('./billing')
      const admin = makeAdminStub(null, 0)
      const subscription = makeSubscription({ status: 'canceled' })

      await assert.rejects(
        () => handleSubscriptionDeleted(subscription, { admin }),
        (err: Error) => err instanceof Error && err.message.includes('Zero rows matched')
      )
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

    it('sets grace_period_ends_at to 7 days from invoice.created', async () => {
      const { handleInvoicePaymentFailed } = await import('./billing')
      const admin = makeAdminStub()
      // created = 2025-01-01T00:00:00Z in UNIX seconds
      const createdSec = Math.floor(new Date('2025-01-01T00:00:00Z').getTime() / 1000)
      const invoice = makeInvoice({ created: createdSec })

      await handleInvoicePaymentFailed(invoice, { admin })

      const cap = admin._captures[0]
      const expected = new Date(createdSec * 1000 + 7 * 24 * 60 * 60 * 1000).toISOString()
      assert.equal(
        cap.values.grace_period_ends_at,
        expected,
        'grace_period_ends_at should be exactly invoice.created + 7 days as ISO string'
      )
    })

    it('sets grace_period_ends_at to ~7 days from now when invoice.created is absent', async () => {
      const { handleInvoicePaymentFailed } = await import('./billing')
      const admin = makeAdminStub()
      const before = Date.now()
      // makeInvoice() does not include `created`
      const invoice = makeInvoice()

      await handleInvoicePaymentFailed(invoice, { admin })

      const after = Date.now()
      const cap = admin._captures[0]
      const gracePeriod = new Date(cap.values.grace_period_ends_at as string).getTime()
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
      // grace period should be ≈ now + 7 days (within a 5-second window for test jitter)
      assert.ok(
        gracePeriod >= before + sevenDaysMs - 5000 && gracePeriod <= after + sevenDaysMs + 5000,
        `grace_period_ends_at (${cap.values.grace_period_ends_at}) should be ~7 days from now`
      )
    })

    it('throws when zero rows matched for stripe_customer_id', async () => {
      const { handleInvoicePaymentFailed } = await import('./billing')
      const admin = makeAdminStub(null, 0)
      const invoice = makeInvoice()

      await assert.rejects(
        () => handleInvoicePaymentFailed(invoice, { admin }),
        (err: Error) => err instanceof Error && err.message.includes('Zero rows matched')
      )
    })

    it('skips and logs when invoice has no customer', async () => {
      const { handleInvoicePaymentFailed } = await import('./billing')
      const admin = makeAdminStub()
      const invoice = makeInvoice({ customer: null })

      await handleInvoicePaymentFailed(invoice, { admin })

      assert.equal(admin._captures.length, 0)
    })
  })

  describe('handleCheckoutSessionCompleted — storage + grace period', () => {
    it('sets storage_limit_bytes matching the plan', async () => {
      const { handleCheckoutSessionCompleted } = await import('./billing')
      const { getPlanStorageLimitBytes } = await import('./plan-gates')
      const admin = makeAdminStub()
      const session = makeCheckoutSession() // starter price → plan='starter'

      await handleCheckoutSessionCompleted(session, { admin })

      const cap = admin._captures[0]
      assert.equal(
        cap.values.storage_limit_bytes,
        getPlanStorageLimitBytes('starter'),
        'storage_limit_bytes should match the starter plan limit'
      )
    })

    it('clears grace_period_ends_at (sets to null) on successful checkout', async () => {
      const { handleCheckoutSessionCompleted } = await import('./billing')
      const admin = makeAdminStub()
      const session = makeCheckoutSession()

      await handleCheckoutSessionCompleted(session, { admin })

      const cap = admin._captures[0]
      assert.equal(
        cap.values.grace_period_ends_at,
        null,
        'grace_period_ends_at should be null after a successful checkout'
      )
    })
  })

  describe('handleSubscriptionUpdated — storage + grace period', () => {
    it('sets storage_limit_bytes matching the plan', async () => {
      const { handleSubscriptionUpdated } = await import('./billing')
      const { getPlanStorageLimitBytes } = await import('./plan-gates')
      const admin = makeAdminStub()
      const subscription = makeSubscription() // studio price → plan='studio'

      await handleSubscriptionUpdated(subscription, { admin })

      const cap = admin._captures[0]
      assert.equal(
        cap.values.storage_limit_bytes,
        getPlanStorageLimitBytes('studio'),
        'storage_limit_bytes should match the studio plan limit'
      )
    })

    it('clears grace_period_ends_at when subscription status is active', async () => {
      const { handleSubscriptionUpdated } = await import('./billing')
      const admin = makeAdminStub()
      const subscription = makeSubscription({ status: 'active' })

      await handleSubscriptionUpdated(subscription, { admin })

      const cap = admin._captures[0]
      assert.equal(
        cap.values.grace_period_ends_at,
        null,
        'grace_period_ends_at should be null when status is active'
      )
    })

    it('clears grace_period_ends_at when subscription status is trialing', async () => {
      const { handleSubscriptionUpdated } = await import('./billing')
      const admin = makeAdminStub()
      const subscription = makeSubscription({ status: 'trialing' })

      await handleSubscriptionUpdated(subscription, { admin })

      const cap = admin._captures[0]
      assert.equal(
        cap.values.grace_period_ends_at,
        null,
        'grace_period_ends_at should be null when status is trialing'
      )
    })

    it('does NOT clear grace_period_ends_at when subscription status maps to past_due', async () => {
      const { handleSubscriptionUpdated } = await import('./billing')
      const admin = makeAdminStub()
      const subscription = makeSubscription({ status: 'past_due' })

      await handleSubscriptionUpdated(subscription, { admin })

      const cap = admin._captures[0]
      assert.equal(
        'grace_period_ends_at' in cap.values,
        false,
        'grace_period_ends_at should not be written when status remains past_due'
      )
    })
  })
})
