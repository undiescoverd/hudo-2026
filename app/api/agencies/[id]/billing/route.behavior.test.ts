/**
 * Behavioural tests: /api/agencies/[id]/billing stays owner-only (S5-ADMIN-001).
 * Plan change (POST checkout) and the legal-entity edit that feeds it (PATCH) must
 * reject a billing-granted admin agent as firmly as an agent, talent or ungranted admin.
 *
 * Run: pnpm exec tsx "app/api/agencies/[id]/billing/route.behavior.test.ts"
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { NextRequest } from 'next/server'
import { afterEach, before, describe, it } from 'node:test'

const SB = 'https://sb.agency-billing.test'
const REDIS = 'https://redis.agency-billing.test'
const AGENCY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER = '11111111-1111-4111-8111-111111111111'
const realFetch = globalThis.fetch

let membership: { role: string; can_manage_billing: boolean } | null = null
let writes: string[] = []

type Handler = (req: NextRequest, ctx: { params: { id: string } }) => Promise<Response | undefined>
let PATCH: Handler
let POST: Handler
let runInScope: <T>(fn: () => Promise<T>) => Promise<T>

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const method = (init.method ?? 'GET').toUpperCase()
    if (url.origin === REDIS) {
      let body: unknown
      try {
        body = JSON.parse(String(init.body))
      } catch {
        body = null
      }
      const n = Array.isArray(body) ? body.length : 1
      const items = Array.from({ length: n }, () => ({ result: 1 }))
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
        email: 'x@agency-billing.test',
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      })
    }
    if (url.pathname === '/rest/v1/memberships') return rows(membership ? [membership] : [])
    if (method !== 'GET') writes.push(`${method} ${url.pathname}`)
    if (url.pathname === '/rest/v1/agencies') return new Response(null, { status: 204 })
    return json(404, { message: `unexpected ${url.pathname}` })
  }) as typeof fetch
}

const legalBody = {
  legal_name: 'Acme Ltd',
  billing_address: { line1: '1 High St', city: 'London', postal_code: 'N1 1AA' },
}

function call(method: 'PATCH' | 'POST', body: unknown) {
  writes = []
  installFetch()
  const req = new Request(`http://localhost:3000/api/agencies/${AGENCY}/billing`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
  Object.defineProperty(req, 'nextUrl', { value: new URL(req.url) })
  const handler = method === 'PATCH' ? PATCH : POST
  return runInScope(() => handler(req, { params: { id: AGENCY } })) as Promise<Response>
}

before(async () => {
  const req = createRequire(import.meta.url)
  const id = req.resolve('server-only')
  req.cache[id] = { id, filename: id, loaded: true, exports: {} } as unknown as NodeJS.Module
  process.env.NEXT_PUBLIC_SUPABASE_URL = SB
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-agency-billing-test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-agency-billing-test'
  process.env.UPSTASH_REDIS_REST_URL = REDIS
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-agency-billing-test'
  process.env.NEXT_PUBLIC_BILLING_ENABLED = 'true'
  const { AsyncLocalStorage } = await import('node:async_hooks')
  ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
  const { requestAsyncStorage } =
    await import('next/dist/client/components/request-async-storage.external')
  const session = {
    access_token: 'access-agency-billing-test',
    refresh_token: 'refresh-agency-billing-test',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: USER, aud: 'authenticated' },
  }
  const cookieList = [{ name: 'sb-sb-auth-token', value: JSON.stringify(session) }]
  const cookies = { getAll: () => cookieList, set: () => {}, get: () => undefined }
  runInScope = (fn) =>
    requestAsyncStorage.run({ cookies, mutableCookies: cookies } as never, fn) as Promise<never>
  ;({ PATCH, POST } = await import('./route'))
})

afterEach(() => {
  globalThis.fetch = realFetch
  membership = null
})

describe('agencies/[id]/billing — plan change and legal entity stay owner-only', () => {
  it('a billing-granted admin agent is rejected on PATCH and POST (403, nothing written)', async () => {
    membership = { role: 'admin_agent', can_manage_billing: true }
    assert.equal((await call('PATCH', legalBody)).status, 403)
    assert.equal((await call('POST', { plan: 'starter' })).status, 403)
    assert.deepEqual(writes, [])
  })

  it('ungranted admin agent, agent and talent are rejected', async () => {
    for (const role of ['admin_agent', 'agent', 'talent']) {
      membership = { role, can_manage_billing: false }
      assert.equal((await call('PATCH', legalBody)).status, 403, role)
      assert.equal((await call('POST', { plan: 'starter' })).status, 403, role)
    }
    assert.deepEqual(writes, [])
  })

  it('the owner can still save legal entity data', async () => {
    membership = { role: 'owner', can_manage_billing: false }
    const res = await call('PATCH', legalBody)
    assert.equal(res.status, 200)
    assert.deepEqual(writes, ['PATCH /rest/v1/agencies'])
  })
})
