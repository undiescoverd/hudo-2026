/**
 * Behavioural tests for PATCH /api/agencies/[id]/members/[userId]/billing-access
 * (S5-ADMIN-001). The real handler runs with Supabase REST/Auth and Upstash stubbed at
 * the fetch layer (same harness as the guest-links behaviour test).
 *
 * Run: pnpm exec tsx "app/api/agencies/[id]/members/[userId]/billing-access/route.behavior.test.ts"
 */

import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import { afterEach, before, describe, it } from 'node:test'

const SB = 'https://sb.billing-access.test'
const REDIS = 'https://redis.billing-access.test'
const AGENCY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CALLER = '11111111-1111-4111-8111-111111111111'
const TARGET = '22222222-2222-4222-8222-222222222222'
const TARGET_MEMBERSHIP = '33333333-3333-4333-8333-333333333333'
const realFetch = globalThis.fetch

type Row = { id: string; role: string; can_manage_billing: boolean }
type Call = { method: string; url: URL; body: unknown }

let calls: Call[] = []
let callerRole = 'owner'
let target: Row | null = null
let redisCount = 1
let auditDone = false
let auditSeen = false
let updateRows: unknown[] = [{ id: TARGET_MEMBERSHIP }]
let auditFails = false
let rollbackFails = false

type Handler = (
  req: NextRequest,
  ctx: { params: { id: string; userId: string } }
) => Promise<Response>
let PATCH: Handler
let runInScope: <T>(fn: () => Promise<T>) => Promise<T>

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const method = (init.method ?? 'GET').toUpperCase()
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
    calls.push({ method, url, body })
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
        id: CALLER,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'owner@billing-access.test',
        app_metadata: {},
        user_metadata: { full_name: 'Olive Owner' },
        created_at: new Date().toISOString(),
      })
    }
    if (url.pathname === '/rest/v1/memberships' && method === 'GET') {
      const who = url.searchParams.get('user_id')
      if (who === `eq.${CALLER}`) return rows(callerRole === 'none' ? [] : [{ role: callerRole }])
      if (who === `eq.${TARGET}`) return rows(target ? [target] : [])
      return rows([])
    }
    if (url.pathname === '/rest/v1/memberships' && method === 'PATCH') {
      const isRollback = auditSeen
      if (isRollback && rollbackFails) return json(500, { message: 'rollback down' })
      return json(200, updateRows)
    }
    if (url.pathname === '/rest/v1/audit_log' && method === 'POST') {
      await new Promise((r) => setTimeout(r, 40))
      auditSeen = true
      if (auditFails) return json(500, { message: 'audit down' })
      auditDone = true
      return json(201, [])
    }
    return json(404, { message: `unexpected ${method} ${url.pathname}` })
  }) as typeof fetch
}

function call(body: unknown, ids = { id: AGENCY, userId: TARGET }) {
  calls = []
  auditDone = false
  auditSeen = false
  installFetch()
  const req = new Request('http://localhost:3000/api/x', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest
  Object.defineProperty(req, 'nextUrl', { value: new URL(req.url) })
  return runInScope(() => PATCH(req, { params: ids }))
}

const updates = () =>
  calls.filter((c) => c.url.pathname === '/rest/v1/memberships' && c.method === 'PATCH')
const audits = () => calls.filter((c) => c.url.pathname === '/rest/v1/audit_log')

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SB
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-billing-access-test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-billing-access-test'
  process.env.UPSTASH_REDIS_REST_URL = REDIS
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-billing-access-test'
  const { AsyncLocalStorage } = await import('node:async_hooks')
  ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
  const { requestAsyncStorage } =
    await import('next/dist/client/components/request-async-storage.external')
  const session = {
    access_token: 'access-billing-access-test',
    refresh_token: 'refresh-billing-access-test',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: CALLER, aud: 'authenticated' },
  }
  const cookieList = [{ name: 'sb-sb-auth-token', value: JSON.stringify(session) }]
  const cookies = { getAll: () => cookieList, set: () => {}, get: () => undefined }
  runInScope = (fn) =>
    requestAsyncStorage.run({ cookies, mutableCookies: cookies } as never, fn) as Promise<never>
  ;({ PATCH } = await import('./route'))
})

afterEach(() => {
  globalThis.fetch = realFetch
  callerRole = 'owner'
  target = { id: TARGET_MEMBERSHIP, role: 'admin_agent', can_manage_billing: false }
  redisCount = 1
  auditFails = false
  rollbackFails = false
  updateRows = [{ id: TARGET_MEMBERSHIP }]
})

describe('PATCH billing-access — grant and revoke', () => {
  it('owner grants an admin agent: column set, audit row written and awaited', async () => {
    target = { id: TARGET_MEMBERSHIP, role: 'admin_agent', can_manage_billing: false }
    const res = await call({ enabled: true })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { userId: TARGET, canManageBilling: true })
    assert.equal(updates().length, 1)
    assert.deepEqual(updates()[0].body, { can_manage_billing: true })
    assert.equal(auditDone, true, 'audit insert must complete before the response resolves')
    const audit = audits()[0].body as Record<string, unknown>
    assert.equal(audit.action, 'billing_access_granted')
    assert.equal(audit.resource_type, 'membership')
    assert.equal(audit.resource_id, TARGET_MEMBERSHIP)
    assert.equal(audit.agency_id, AGENCY)
    assert.equal(audit.actor_id, CALLER)
  })

  it('owner revokes: column cleared, revoke audited', async () => {
    target = { id: TARGET_MEMBERSHIP, role: 'admin_agent', can_manage_billing: true }
    const res = await call({ enabled: false })
    assert.equal(res.status, 200)
    assert.deepEqual(updates()[0].body, { can_manage_billing: false })
    assert.equal((audits()[0].body as Record<string, unknown>).action, 'billing_access_revoked')
  })

  it('setting the value it already has changes and audits nothing', async () => {
    target = { id: TARGET_MEMBERSHIP, role: 'admin_agent', can_manage_billing: true }
    const res = await call({ enabled: true })
    assert.equal(res.status, 200)
    assert.equal(updates().length, 0)
    assert.equal(audits().length, 0)
  })

  it('the update is pinned to the admin_agent role (concurrent demotion cannot slip through)', async () => {
    await call({ enabled: true })
    assert.equal(updates()[0].url.searchParams.get('role'), 'eq.admin_agent')
    assert.equal(updates()[0].url.searchParams.get('id'), `eq.${TARGET_MEMBERSHIP}`)
  })

  it('a demotion racing the update (no row matched) -> 404 and no audit', async () => {
    updateRows = []
    const res = await call({ enabled: true })
    assert.equal(res.status, 404)
    assert.equal(audits().length, 0)
  })
})

describe('PATCH billing-access — audit is a hard gate', () => {
  it('audit insert fails -> 500 and the flag is restored to its previous value', async () => {
    target = { id: TARGET_MEMBERSHIP, role: 'admin_agent', can_manage_billing: false }
    auditFails = true
    const res = await call({ enabled: true })
    assert.equal(res.status, 500)
    const ups = updates()
    assert.equal(ups.length, 2)
    assert.deepEqual(ups[0].body, { can_manage_billing: true })
    assert.deepEqual(ups[1].body, { can_manage_billing: false })
  })

  it('a failed revoke audit restores the grant', async () => {
    target = { id: TARGET_MEMBERSHIP, role: 'admin_agent', can_manage_billing: true }
    auditFails = true
    const res = await call({ enabled: false })
    assert.equal(res.status, 500)
    assert.deepEqual(updates()[1].body, { can_manage_billing: true })
  })

  it('audit and rollback both fail -> still 500 (reported as critical, never 200)', async () => {
    auditFails = true
    rollbackFails = true
    const res = await call({ enabled: true })
    assert.equal(res.status, 500)
  })
})

describe('PATCH billing-access — who may call it', () => {
  it('admin agent, agent and talent callers -> 403, nothing written (no self-grant)', async () => {
    for (const role of ['admin_agent', 'agent', 'talent']) {
      callerRole = role
      const res = await call({ enabled: true })
      assert.equal(res.status, 403, role)
      assert.equal(updates().length, 0, role)
      assert.equal(audits().length, 0, role)
    }
  })

  it('caller with no membership in this agency -> 403, nothing written', async () => {
    callerRole = 'none'
    const res = await call({ enabled: true })
    assert.equal(res.status, 403)
    assert.equal(updates().length, 0)
  })
})

describe('PATCH billing-access — target and input validation', () => {
  it('only admin agents can be targeted: owner, agent, talent -> 400, nothing written', async () => {
    for (const role of ['owner', 'agent', 'talent']) {
      target = { id: TARGET_MEMBERSHIP, role, can_manage_billing: false }
      const res = await call({ enabled: true })
      assert.equal(res.status, 400, role)
      assert.equal(updates().length, 0, role)
    }
  })

  it('target not in this agency -> 404', async () => {
    target = null
    assert.equal((await call({ enabled: true })).status, 404)
  })

  it('enabled must be a boolean; bad JSON -> 400', async () => {
    for (const bad of [{}, { enabled: 'true' }, { enabled: 1 }, { enabled: null }]) {
      assert.equal((await call(bad)).status, 400)
    }
    assert.equal((await call('not json')).status, 400)
    assert.equal(updates().length, 0)
  })

  it('malformed ids -> 400', async () => {
    assert.equal((await call({ enabled: true }, { id: 'x', userId: TARGET })).status, 400)
    assert.equal((await call({ enabled: true }, { id: AGENCY, userId: 'x' })).status, 400)
  })

  it('over the rate limit -> 429 with Retry-After, nothing written', async () => {
    redisCount = 10_000
    const res = await call({ enabled: true })
    assert.equal(res.status, 429)
    assert.ok(res.headers.get('retry-after'))
    assert.equal(updates().length, 0)
  })
})
