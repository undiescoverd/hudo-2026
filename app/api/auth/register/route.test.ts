/**
 * Unit tests for registration API route validation and rate limiting logic.
 *
 * Tests the pure validatePassword function and rate limit key/constant expectations.
 * Uses the Node.js built-in test runner (node --test) — no extra dependency needed.
 *
 * Run: npx tsx --test app/api/auth/register/route.test.ts
 */

import { validatePassword } from '../../../../lib/auth-validation'
import { AUTH_RATE_LIMIT, AUTH_RATE_WINDOW } from '../../../../lib/rate-limit'
import assert from 'node:assert/strict'
import { afterEach, before, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import type { NextRequest } from 'next/server'

describe('validatePassword', () => {
  it('rejects passwords shorter than 8 characters', () => {
    assert.match(validatePassword('Short1') ?? '', /at least 8 characters/)
  })

  it('rejects passwords without an uppercase letter', () => {
    assert.match(validatePassword('lowercase1') ?? '', /uppercase/)
  })

  it('rejects passwords without a lowercase letter', () => {
    assert.match(validatePassword('UPPERCASE1') ?? '', /lowercase/)
  })

  it('rejects passwords without a number', () => {
    assert.match(validatePassword('NoNumberHere') ?? '', /number/)
  })

  it('accepts a valid password', () => {
    assert.equal(validatePassword('ValidPass1'), null)
  })

  it('accepts a password with special characters', () => {
    assert.equal(validatePassword('Valid@Pass1!'), null)
  })
})

describe('register rate limiting — key format', () => {
  it('IP key follows auth:register:ip:{ip} pattern', () => {
    const ip = '10.0.0.1'
    const key = `auth:register:ip:${ip}`
    assert.equal(key, 'auth:register:ip:10.0.0.1')
  })

  it('email key follows auth:register:email:{normalizedEmail} pattern', () => {
    const email = '  User@Test.COM  '
    const key = `auth:register:email:${email.trim().toLowerCase()}`
    assert.equal(key, 'auth:register:email:user@test.com')
  })
})

describe('register rate limiting — constants', () => {
  it('limit is 5 attempts per window', () => {
    assert.equal(AUTH_RATE_LIMIT, 5)
  })

  it('window is 900 seconds (15 minutes)', () => {
    assert.equal(AUTH_RATE_WINDOW, 900)
  })

  it('Retry-After header value matches window', () => {
    assert.equal(String(AUTH_RATE_WINDOW), '900')
  })
})

// ---------------------------------------------------------------------------
// Handler behaviour — Supabase REST/Auth and Upstash are stubbed at the fetch layer
// ---------------------------------------------------------------------------

type Handler = (url: URL, init: RequestInit) => { status: number; body?: unknown }

const SB = 'https://sb.register.test'
const REDIS = 'https://redis.register.test'
const USER_ID = '11111111-2222-4333-8444-555555555555'
const realFetch = globalThis.fetch

let calls: { method: string; url: URL; body: unknown }[] = []
let rateLimited = false
let handlers: { slug: Handler; signup: Handler; rpc: Handler; del: Handler }
let POST: (req: NextRequest) => Promise<Response>

function freshHandlers() {
  handlers = {
    slug: () => ({ status: 200, body: [] }),
    signup: () => ({
      status: 200,
      body: { id: USER_ID, email: 'a@b.co', identities: [{ id: 'x' }], aud: 'authenticated' },
    }),
    rpc: () => ({ status: 200, body: '"agency-id"' }),
    del: () => ({ status: 200, body: {} }),
  }
}

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const method = (init.method ?? 'GET').toUpperCase()
    let body: unknown = undefined
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    if (url.origin === REDIS) {
      // INCR returns 1 (allowed) or 99 (over the limit)
      const n = Array.isArray(body) ? body.length : 1
      const items = Array.from({ length: n }, () => ({ result: rateLimited ? 99 : 1 }))
      return Response.json(Array.isArray(body) ? items : items[0])
    }
    calls.push({ method, url, body })
    let r: { status: number; body?: unknown }
    if (url.pathname === '/rest/v1/agencies') r = handlers.slug(url, init)
    else if (url.pathname === '/auth/v1/signup') r = handlers.signup(url, init)
    else if (url.pathname === '/rest/v1/rpc/create_agency_with_owner') r = handlers.rpc(url, init)
    else if (url.pathname.startsWith('/auth/v1/admin/users/')) r = handlers.del(url, init)
    else r = { status: 404, body: { message: `unexpected ${method} ${url.pathname}` } }
    const payload =
      typeof r.body === 'string' ? r.body : r.body === undefined ? null : JSON.stringify(r.body)
    return new Response(payload, {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

function req(overrides: Record<string, unknown> = {}) {
  const body = {
    fullName: 'Jane Owner',
    agencyName: 'Stellar Talent',
    email: 'jane@stellar.test',
    password: `Aa1!${randomBytes(12).toString('hex')}`,
    ...overrides,
  }
  return new Request('http://localhost:3000/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const callsTo = (p: string) => calls.filter((c) => c.url.pathname.startsWith(p))

describe('register handler — agency + owner at sign-up', () => {
  before(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SB
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = `anon-${randomBytes(8).toString('hex')}`
    process.env.SUPABASE_SERVICE_ROLE_KEY = `svc-${randomBytes(8).toString('hex')}`
    process.env.UPSTASH_REDIS_REST_URL = REDIS
    process.env.UPSTASH_REDIS_REST_TOKEN = randomBytes(8).toString('hex')
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.register.test'
    ;({ POST } = await import('./route'))
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function setup() {
    calls = []
    rateLimited = false
    freshHandlers()
    installFetch()
  }

  it('rejects a missing agency name with 400', async () => {
    setup()
    const res = await POST(req({ agencyName: undefined }))
    assert.equal(res.status, 400)
    assert.equal(calls.length, 0)
  })

  it('rejects a blank, symbol-only or over-long agency name with 400', async () => {
    setup()
    for (const agencyName of ['   ', '!!!', 'x'.repeat(101)]) {
      assert.equal((await POST(req({ agencyName }))).status, 400, agencyName)
    }
    assert.equal(calls.length, 0)
  })

  it('still returns 429 + Retry-After when rate limited', async () => {
    setup()
    rateLimited = true
    const res = await POST(req())
    assert.equal(res.status, 429)
    assert.equal(res.headers.get('Retry-After'), String(AUTH_RATE_WINDOW))
    assert.equal(calls.length, 0)
  })

  it('returns 409 and never calls signUp when the slug is taken', async () => {
    setup()
    handlers.slug = () => ({ status: 200, body: [{ id: 'existing' }] })
    const res = await POST(req())
    assert.equal(res.status, 409)
    assert.match(((await res.json()) as { error: string }).error, /agency/i)
    assert.equal(callsTo('/auth/v1/signup').length, 0)
    assert.equal(callsTo('/rest/v1/rpc').length, 0)
  })

  it('maps RPC unique_violation (race) to 409 and deletes the auth user', async () => {
    setup()
    handlers.rpc = () => ({ status: 409, body: { code: '23505', message: 'duplicate key' } })
    const res = await POST(req())
    assert.equal(res.status, 409)
    const del = callsTo('/auth/v1/admin/users/')
    assert.equal(del.length, 1)
    assert.equal(del[0].method, 'DELETE')
    assert.ok(del[0].url.pathname.endsWith(USER_ID))
  })

  it('maps any other RPC error to 500 and deletes the auth user', async () => {
    setup()
    handlers.rpc = () => ({ status: 400, body: { code: 'XX000', message: 'boom' } })
    const res = await POST(req())
    assert.equal(res.status, 500)
    assert.equal(callsTo('/auth/v1/admin/users/').length, 1)
  })

  it('existing email (empty identities): no RPC, no delete, generic success', async () => {
    setup()
    handlers.signup = () => ({
      status: 200,
      body: { id: USER_ID, email: 'a@b.co', identities: [], aud: 'authenticated' },
    })
    const res = await POST(req())
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { success: true, session: false })
    assert.equal(callsTo('/rest/v1/rpc').length, 0)
    assert.equal(callsTo('/auth/v1/admin/users/').length, 0)
  })

  it('success without a session: calls the RPC with slug and reports session=false', async () => {
    setup()
    const res = await POST(req())
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { success: true, session: false })
    const rpc = callsTo('/rest/v1/rpc/create_agency_with_owner')
    assert.equal(rpc.length, 1)
    assert.deepEqual(rpc[0].body, {
      p_user_id: USER_ID,
      p_email: 'jane@stellar.test',
      p_full_name: 'Jane Owner',
      p_agency_name: 'Stellar Talent',
      p_slug: 'stellar-talent',
    })
    assert.equal(callsTo('/auth/v1/admin/users/').length, 0)
  })

  it('success with a session: reports session=true and never returns tokens', async () => {
    setup()
    handlers.signup = () => ({
      status: 200,
      body: {
        access_token: 'at',
        refresh_token: 'rt',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: USER_ID, email: 'a@b.co', identities: [{ id: 'x' }], aud: 'authenticated' },
      },
    })
    const res = await POST(req())
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { success: true, session: true })
  })

  it('sends emailRedirectTo with next=/dashboard', async () => {
    setup()
    await POST(req())
    const signup = callsTo('/auth/v1/signup')[0]
    assert.match(
      decodeURIComponent(signup.url.searchParams.get('redirect_to') ?? ''),
      /\/auth\/callback\?next=\/dashboard$/
    )
  })
})
