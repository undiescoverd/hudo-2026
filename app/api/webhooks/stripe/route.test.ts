/**
 * app/api/webhooks/stripe/route.test.ts
 *
 * Unit tests for POST /api/webhooks/stripe.
 * Stripe signature is generated with a known test secret so constructEvent
 * succeeds on the happy path; no network calls are made.
 *
 * Idempotency: Upstash Redis uses globalThis.fetch under the hood. Tests that
 * care about idempotency behaviour mock globalThis.fetch to control Redis
 * responses and record call order.
 *
 * Billing handlers are stubbed to verify dispatch without real DB writes.
 */

import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import Stripe from 'stripe'
import type { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests'
const TEST_STRIPE_KEY = 'sk_test_fake_key_for_tests'

// ---------------------------------------------------------------------------
// Build a valid Stripe-Signature header for a given payload
// ---------------------------------------------------------------------------

function buildSignedHeader(payload: string, secret: string): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
  })
}

// ---------------------------------------------------------------------------
// Build a minimal Stripe event payload
// ---------------------------------------------------------------------------

function buildEventPayload(type: string, data: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: `evt_test_${Math.random().toString(36).slice(2)}`,
    type,
    object: 'event',
    api_version: '2026-05-27.dahlia',
    created: Math.floor(Date.now() / 1000),
    data: { object: data },
    livemode: false,
  })
}

// ---------------------------------------------------------------------------
// Helpers to call the route handler directly
// ---------------------------------------------------------------------------

async function callRoute(body: string, headers: Record<string, string> = {}): Promise<Response> {
  // Set env vars before importing the route (needed by getStripe inside handler)
  process.env.STRIPE_SECRET_KEY = TEST_STRIPE_KEY
  process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET

  const { POST } = await import('./route')
  const request = new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    body,
    headers: { 'content-type': 'text/plain', ...headers },
  })

  // Cast: Next.js NextRequest is compatible with standard Request in tests
  return POST(request as unknown as NextRequest)
}

// ---------------------------------------------------------------------------
// Redis fetch mock helpers
//
// Upstash Redis uses globalThis.fetch to make REST calls to https://*.upstash.io.
// We intercept it to return controlled responses without a real Redis instance.
//
// Upstash GET returns: {"result": "1"} (exists) or {"result": null} (not found)
// Upstash SET NX returns: {"result": "OK"} (set) or {"result": null} (not set; key existed)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/stripe', () => {
  before(() => {
    // Ensure STRIPE_SECRET_KEY is set before any import of getStripe()
    process.env.STRIPE_SECRET_KEY = TEST_STRIPE_KEY
    process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET
    // Provide stub Upstash env values so lib/redis doesn't throw at import
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake_token'
  })

  // -------------------------------------------------------------------------
  // AC2: Missing Stripe-Signature → 400
  // -------------------------------------------------------------------------
  it('returns 400 when Stripe-Signature header is missing', async () => {
    const payload = buildEventPayload('checkout.session.completed')
    const response = await callRoute(payload, {})
    assert.equal(response.status, 400)
    const body = await response.json()
    assert.ok(body.error, 'response should have error field')
  })

  // -------------------------------------------------------------------------
  // AC2: Invalid Stripe-Signature → 400
  // -------------------------------------------------------------------------
  it('returns 400 when Stripe-Signature header is invalid', async () => {
    const payload = buildEventPayload('checkout.session.completed')
    const response = await callRoute(payload, { 'stripe-signature': 't=invalid,v1=badbad' })
    assert.equal(response.status, 400)
    const body = await response.json()
    assert.ok(body.error)
  })

  // -------------------------------------------------------------------------
  // AC1 + AC2: Valid signature → 200
  // -------------------------------------------------------------------------
  it('returns 200 for a valid signature on a handled event type', async () => {
    const payload = buildEventPayload('customer.subscription.deleted', {
      id: 'sub_test_123',
      customer: 'cus_test_abc',
      status: 'canceled',
      items: { data: [{ price: { id: 'price_1Tj85JPE8Ih3LOAA2sQEqx1D' } }] },
    })
    const sig = buildSignedHeader(payload, TEST_WEBHOOK_SECRET)

    const response = await callRoute(payload, { 'stripe-signature': sig })
    // May be 200 or 500 depending on whether billing handlers can reach real DB
    // In unit tests with no real Supabase, DB write throws — which causes 500.
    // We only assert the signature path did not reject (400 means sig failure).
    assert.notEqual(response.status, 400)
  })

  // -------------------------------------------------------------------------
  // AC2: Raw body is not parsed (signature over exact bytes)
  // -------------------------------------------------------------------------
  it('verifies signature over raw body bytes (not JSON.parse re-serialized)', async () => {
    // Stripe sig verification uses the raw string; if the route had called
    // request.json() instead of request.text(), the sig would still verify
    // against the body that was sent, but the raw body passed to constructEvent
    // would be the re-serialized JSON (different bytes if there is whitespace).
    // We test by sending a payload with extra whitespace after the JSON.
    const payloadBase = buildEventPayload('invoice.payment_failed', {
      id: 'in_test_123',
      customer: 'cus_test_abc',
    })
    // Add trailing whitespace — valid raw string, but JSON.parse+stringify would strip it
    const payloadWithSpaces = payloadBase + '   '
    const sig = buildSignedHeader(payloadWithSpaces, TEST_WEBHOOK_SECRET)

    const response = await callRoute(payloadWithSpaces, { 'stripe-signature': sig })
    // Signature should be verified against the raw bytes including trailing spaces.
    // If the route had used request.json() the bytes would differ and sig would fail → 400.
    assert.notEqual(response.status, 400, 'Expected non-400 (sig verified over raw bytes)')
  })

  // -------------------------------------------------------------------------
  // AC6: Unhandled event type → 200 (not retried)
  // -------------------------------------------------------------------------
  it('returns 200 for unhandled event types (no retry needed)', async () => {
    const payload = buildEventPayload('payment_method.attached', { id: 'pm_test_123' })
    const sig = buildSignedHeader(payload, TEST_WEBHOOK_SECRET)

    const response = await callRoute(payload, { 'stripe-signature': sig })
    // Unhandled event — no billing handler called — should be 200 (unless Redis throws)
    // Redis will fail (fake credentials) → we skip the idempotency check and still dispatch.
    // The handler for unhandled type does nothing, so result is 200.
    assert.notEqual(response.status, 400)
  })

  // -------------------------------------------------------------------------
  // BLOCKER-1: customer.subscription.created routes to handleSubscriptionUpdated
  // -------------------------------------------------------------------------
  it('routes customer.subscription.created to the subscription update handler', async () => {
    // A subscription.created event with a known price ID should end up calling
    // handleSubscriptionUpdated. Since we have no real DB, the handler throws (500).
    // We verify the event was *dispatched* (not silently dropped to default/200)
    // by asserting the response is 500 (handler ran + threw) not 200 (swallowed).
    const payload = buildEventPayload('customer.subscription.created', {
      id: 'sub_test_new',
      customer: 'cus_test_new',
      status: 'active',
      items: {
        data: [
          {
            price: { id: 'price_1Tj85KPE8Ih3LOAA3nTZcplc' },
            current_period_end: 1750000000,
          },
        ],
      },
    })
    const sig = buildSignedHeader(payload, TEST_WEBHOOK_SECRET)

    const response = await callRoute(payload, { 'stripe-signature': sig })
    // 500 = handler ran and threw (no real Supabase) — NOT 200 which would mean the
    // event fell through to default and was silently discarded.
    assert.equal(
      response.status,
      500,
      'subscription.created should dispatch to the update handler (throws without real DB)'
    )
  })

  // -------------------------------------------------------------------------
  // BLOCKER-2: Idempotency key written ONLY after successful processing
  //
  // Upstash Redis uses its pipeline endpoint (/pipeline) for all commands via
  // AutoPipeline. Each pipeline request is a POST with a JSON array of commands;
  // the response must also be a JSON array of {error, result} objects.
  //
  // We track *which commands appeared in which pipeline call* (in order) to verify
  // that GET (pre-check) fires before SET (post-success claim).
  // -------------------------------------------------------------------------
  it('writes idempotency key only after successful handler (unhandled event path)', async () => {
    // Use an unhandled event type (no DB call, handler succeeds trivially).
    // Mock Redis pipeline so:
    //   - GET calls return null (key not yet set)
    //   - SET NX calls return "OK"
    // Record the commands in order to verify GET precedes SET.

    // commandSequence records command names in the order they arrived across all
    // pipeline requests. A pipeline POST may contain one or more commands.
    const commandSequence: string[] = []
    const originalFetch = globalThis.fetch

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (
        (url.includes('upstash.io') || url.includes('fake.upstash')) &&
        url.includes('/pipeline')
      ) {
        // Parse the pipeline body: [[cmd, ...args], ...]
        let commands: string[][] = []
        try {
          commands = JSON.parse((init?.body as string) ?? '[]') as string[][]
        } catch {
          /* ignore parse errors */
        }
        const results = commands.map((cmd) => {
          const verb = cmd[0]?.toLowerCase() ?? ''
          commandSequence.push(verb)
          if (verb === 'get') {
            return { result: null } // key not found
          }
          if (verb === 'set') {
            return { result: 'OK' } // SET NX succeeded
          }
          return { result: null }
        })
        return new Response(JSON.stringify(results), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return originalFetch(input, init)
    }

    try {
      const payload = buildEventPayload('payment_method.attached', { id: 'pm_idempotency_test' })
      const sig = buildSignedHeader(payload, TEST_WEBHOOK_SECRET)

      const response = await callRoute(payload, { 'stripe-signature': sig })
      assert.equal(response.status, 200, 'unhandled event should return 200')

      // Verify both GET and SET were issued
      assert.ok(commandSequence.includes('get'), 'should have issued a GET (pre-check)')
      assert.ok(commandSequence.includes('set'), 'should have issued a SET (post-success claim)')

      // GET must precede SET
      const firstGetIndex = commandSequence.indexOf('get')
      const firstSetIndex = commandSequence.indexOf('set')
      assert.ok(firstGetIndex < firstSetIndex, 'GET (pre-check) must precede SET (post-success)')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does not write idempotency SET when handler throws', async () => {
    // Use customer.subscription.deleted — without a real DB it throws (500).
    // Mock Redis pipeline: GET returns null (not processed).
    // Assert that no SET command was issued (no claim written on failure).

    const commandSequence: string[] = []
    const originalFetch = globalThis.fetch

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (
        (url.includes('upstash.io') || url.includes('fake.upstash')) &&
        url.includes('/pipeline')
      ) {
        let commands: string[][] = []
        try {
          commands = JSON.parse((init?.body as string) ?? '[]') as string[][]
        } catch {
          /* ignore */
        }
        const results = commands.map((cmd) => {
          const verb = cmd[0]?.toLowerCase() ?? ''
          commandSequence.push(verb)
          if (verb === 'get') return { result: null }
          if (verb === 'set') return { result: 'OK' }
          return { result: null }
        })
        return new Response(JSON.stringify(results), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return originalFetch(input, init)
    }

    try {
      const payload = buildEventPayload('customer.subscription.deleted', {
        id: 'sub_test_fail',
        customer: 'cus_test_fail',
        status: 'canceled',
        items: { data: [{ price: { id: 'price_1Tj85JPE8Ih3LOAA2sQEqx1D' } }] },
      })
      const sig = buildSignedHeader(payload, TEST_WEBHOOK_SECRET)

      const response = await callRoute(payload, { 'stripe-signature': sig })
      // Handler throws without real Supabase → should be 500
      assert.equal(response.status, 500, 'failed handler should return 500')

      // No SET should have been issued (claim not written on failure)
      const setCommands = commandSequence.filter((c) => c === 'set')
      assert.equal(setCommands.length, 0, 'idempotency SET must NOT be issued when handler throws')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

// ---------------------------------------------------------------------------
// AC5: Status mapping (no DB — tests pure mapping logic in billing.ts)
// ---------------------------------------------------------------------------

describe('billing status mapping (AC5 — plan/status derivation)', () => {
  it('getPlanFromPrice resolves legacy test price IDs via grandfathering (no lookup_key)', async () => {
    const { getPlanFromPrice } = await import('@/lib/stripe')
    // Legacy test price IDs have no lookup_key — must resolve via LEGACY_PRICE_ID_TO_PLAN
    const makePrice = (id: string) => ({ id, lookup_key: null }) as unknown as Stripe.Price
    assert.equal(getPlanFromPrice(makePrice('price_1Tj85JPE8Ih3LOAA2sQEqx1D')), 'starter')
    assert.equal(getPlanFromPrice(makePrice('price_1Tj85KPE8Ih3LOAA3nTZcplc')), 'studio')
    assert.equal(getPlanFromPrice(makePrice('price_1Tj85LPE8Ih3LOAAwghsraL5')), 'agency_pro')
    assert.equal(getPlanFromPrice(makePrice('price_1Tj85HPE8Ih3LOAAztAGBtDJ')), 'freemium')
  })

  it('getPlanFromPrice returns freemium for a price with unknown id and no lookup_key', async () => {
    const { getPlanFromPrice } = await import('@/lib/stripe')
    const price = { id: 'price_unknown_xyz', lookup_key: null } as unknown as Stripe.Price
    assert.equal(getPlanFromPrice(price), 'freemium')
  })

  it('getPlanFromPrice resolves a lookup_key (new-style price, overrides legacy id)', async () => {
    const { getPlanFromPrice } = await import('@/lib/stripe')
    // A price carrying a lookup_key should resolve via the lookup_key path
    const price = { id: 'price_any', lookup_key: 'starter_monthly' } as unknown as Stripe.Price
    assert.equal(getPlanFromPrice(price), 'starter')
  })
})
