/**
 * Behavioural tests for POST /api/billing/portal (S5-ADMIN-001).
 *
 * The real handler runs with Supabase REST/Auth and Upstash stubbed at the fetch layer,
 * the Next request scope supplied via AsyncLocalStorage, and the Stripe portal call
 * replaced on the SDK singleton. Same harness as the guest-links behaviour test.
 *
 * Run: pnpm exec tsx app/api/billing/portal/route.behavior.test.ts
 */

import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import { afterEach, before, describe, it } from 'node:test'
import { createRequire } from 'node:module'

const SB = 'https://sb.billing-portal.test'
const REDIS = 'https://redis.billing-portal.test'
const AGENCY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER = '11111111-1111-4111-8111-111111111111'
const realFetch = globalThis.fetch

type Membership = { role: string; can_manage_billing: boolean } | null

let membership: Membership = null
let stripeCustomerId: string | null = 'cus_123'
let redisCount = 1
let portalCalls: Array<Record<string, unknown>> = []
let membershipQueries = 0

let POST: (req: NextRequest) => Promise<Response>
let runInScope: <T>(fn: () => Promise<T>) => Promise<T>

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    let body: unknown
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    if (url.origin === REDIS) {
      const n = Array.isArray(body) ? body.length : 1
      const items = Array.from({ length: n }, () => ({ result: redisCount }))
      return Response.json(Array.isArray(body) ? items : items[0])
    }
    const json = (status: number, b: unknown) =>
      new Response(JSON.stringify(b), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    const wantsObject = new Headers(init.headers).get('accept')?.includes('pgrst.object')
    const rows = (list: unknown[]) =>
      wantsObject
        ? list.length
          ? json(200, list[0])
          : json(406, { code: 'PGRST116', message: 'no rows', details: '', hint: null })
        : json(200, list)

    if (url.pathname === '/auth/v1/user') {
      return json(200, {
        id: USER,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'admin@billing-portal.test',
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      })
    }
    if (url.pathname === '/rest/v1/memberships') {
      membershipQueries++
      return rows(membership ? [membership] : [])
    }
    if (url.pathname === '/rest/v1/agencies') {
      return rows([{ stripe_customer_id: stripeCustomerId }])
    }
    return json(404, { message: `unexpected ${url.pathname}` })
  }) as typeof fetch
}

function call(body: unknown = { agencyId: AGENCY }) {
  portalCalls = []
  installFetch()
  const req = new Request('http://localhost:3000/api/billing/portal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
  Object.defineProperty(req, 'nextUrl', { value: new URL(req.url) })
  return runInScope(() => POST(req))
}

before(async () => {
  // `server-only` is not an installed dependency (Next bundles it); stub the import for this harness.
  const mod = createRequire(import.meta.url)('node:module') as {
    _load: (request: string, ...rest: unknown[]) => unknown
  }
  const realLoad = mod._load
  mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
    if (request === 'server-only') return {}
    return realLoad.call(this, request, ...rest)
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = SB
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-billing-portal-test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-billing-portal-test'
  process.env.UPSTASH_REDIS_REST_URL = REDIS
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-billing-portal-test'
  process.env.NEXT_PUBLIC_BILLING_ENABLED = 'true'
  process.env.STRIPE_SECRET_KEY = 'sk_test_portal_behavior'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.test'
  const { AsyncLocalStorage } = await import('node:async_hooks')
  ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
  const { requestAsyncStorage } =
    await import('next/dist/client/components/request-async-storage.external')
  const session = {
    access_token: 'access-billing-portal-test',
    refresh_token: 'refresh-billing-portal-test',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: USER, aud: 'authenticated' },
  }
  const cookieList = [{ name: 'sb-sb-auth-token', value: JSON.stringify(session) }]
  const cookies = { getAll: () => cookieList, set: () => {}, get: () => undefined }
  runInScope = (fn) =>
    requestAsyncStorage.run({ cookies, mutableCookies: cookies } as never, fn) as Promise<never>

  const { getStripe } = await import('@/lib/stripe')
  const stripe = getStripe()
  ;(stripe.billingPortal.sessions as unknown as { create: unknown }).create = async (
    params: Record<string, unknown>
  ) => {
    portalCalls.push(params)
    return { url: 'https://billing.stripe.test/session' }
  }
  ;({ POST } = await import('./route'))
})

afterEach(() => {
  globalThis.fetch = realFetch
  membership = null
  stripeCustomerId = 'cus_123'
  redisCount = 1
  membershipQueries = 0
  delete process.env.STRIPE_PORTAL_CONFIG_DELEGATE
})

describe('POST /api/billing/portal — who gets in', () => {
  it('owner -> 200 with the default portal configuration', async () => {
    membership = { role: 'owner', can_manage_billing: false }
    const res = await call()
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { url: 'https://billing.stripe.test/session' })
    assert.equal(portalCalls.length, 1)
    assert.equal(portalCalls[0].customer, 'cus_123')
    assert.ok(!('configuration' in portalCalls[0]), 'owner uses the full portal')
  })

  it('granted admin agent -> 200 and the RESTRICTED portal configuration', async () => {
    process.env.STRIPE_PORTAL_CONFIG_DELEGATE = 'bpc_1PaymentOnly'
    membership = { role: 'admin_agent', can_manage_billing: true }
    const res = await call()
    assert.equal(res.status, 200)
    assert.equal(portalCalls[0].configuration, 'bpc_1PaymentOnly')
  })

  it('granted admin agent with no restricted configuration set -> 503, no Stripe call', async () => {
    membership = { role: 'admin_agent', can_manage_billing: true }
    const res = await call()
    assert.equal(res.status, 503)
    assert.equal(portalCalls.length, 0)
  })

  it('malformed restricted configuration id is treated as unset -> 503, no Stripe call', async () => {
    membership = { role: 'admin_agent', can_manage_billing: true }
    for (const bad of ['price_123', 'bpc_', 'bpc_ab cd', 'xbpc_abc', 'bpc_abc\n']) {
      process.env.STRIPE_PORTAL_CONFIG_DELEGATE = bad
      const res = await call()
      assert.equal(res.status, 503, bad)
      assert.equal(portalCalls.length, 0, bad)
    }
  })

  it('ungranted admin agent, agent and talent -> 403, no Stripe call', async () => {
    process.env.STRIPE_PORTAL_CONFIG_DELEGATE = 'bpc_1PaymentOnly'
    for (const m of [
      { role: 'admin_agent', can_manage_billing: false },
      { role: 'agent', can_manage_billing: true },
      { role: 'talent', can_manage_billing: true },
    ]) {
      membership = m
      const res = await call()
      assert.equal(res.status, 403, m.role)
      assert.equal(portalCalls.length, 0, m.role)
    }
  })

  it('no membership in the agency -> 403', async () => {
    membership = null
    assert.equal((await call()).status, 403)
    assert.equal(portalCalls.length, 0)
  })

  it('a revoke applies on the very next request (membership is re-read, not cached)', async () => {
    process.env.STRIPE_PORTAL_CONFIG_DELEGATE = 'bpc_1PaymentOnly'
    membership = { role: 'admin_agent', can_manage_billing: true }
    assert.equal((await call()).status, 200)
    membership = { role: 'admin_agent', can_manage_billing: false }
    assert.equal((await call()).status, 403)
    assert.equal(membershipQueries, 2, 'one fresh membership read per request')
  })
})

describe('POST /api/billing/portal — other guards', () => {
  it('missing/invalid agencyId -> 400', async () => {
    membership = { role: 'owner', can_manage_billing: false }
    assert.equal((await call({})).status, 400)
    assert.equal((await call({ agencyId: 'nope' })).status, 400)
  })

  it('agency without a Stripe customer -> 400', async () => {
    membership = { role: 'owner', can_manage_billing: false }
    stripeCustomerId = null
    assert.equal((await call()).status, 400)
  })

  it('over the rate limit -> 429 with Retry-After', async () => {
    membership = { role: 'owner', can_manage_billing: false }
    redisCount = 10_000
    const res = await call()
    assert.equal(res.status, 429)
    assert.ok(res.headers.get('retry-after'))
  })
})
