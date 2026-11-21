/**
 * Behavioural tests for DELETE /api/users/[userId]/data (S4-ERASE-001).
 *
 * Calls the REAL handler. Mocking follows app/api/invitations/accept/route.test.ts:
 *  - @supabase/supabase-js createClient is replaced (CJS export) with an in-memory
 *    fake; the anon-key client is the "cookie" client (auth.getUser), the
 *    service-role-key client is the admin client.
 *  - next/headers cookies() needs a request scope, so the call runs inside
 *    Next's requestAsyncStorage with an empty cookie jar.
 *  - Upstash is stubbed through globalThis.fetch (rate limiter returns "under limit").
 *  - RESEND_API_KEY is unset, so every sendEmail call throws — which doubles as
 *    the "email failure never fails the erasure" case.
 *
 * Run: npx tsx --test "app/api/users/*\/data/route.behavior.test.ts"
 */

import assert from 'node:assert/strict'
import { describe, it, before, beforeEach, after } from 'node:test'
import { createRequire } from 'node:module'
import { AsyncLocalStorage } from 'node:async_hooks'
import { NextRequest } from 'next/server'

const ANON = 'fake-anon-key'
const SERVICE = 'fake-service-role'

const CALLER = '00000000-0000-4000-8000-0000000000c1'
const TARGET = '00000000-0000-4000-8000-0000000000e1'
const AGENCY_A = '00000000-0000-4000-8000-0000000000a1'
const AGENCY_B = '00000000-0000-4000-8000-0000000000b1'
const AGENCY_X = '00000000-0000-4000-8000-0000000000d1'

type Membership = { user_id: string; agency_id: string; role: string }

interface State {
  callerId: string
  memberships: Membership[]
  rpcCalls: { fn: string; args: Record<string, unknown> }[]
  membershipDeletes: Array<Record<string, unknown>>
  authUsersDeleted: string[]
  tombstoned: boolean
}

let state: State

function freshState(callerId: string, memberships: Membership[]): State {
  return {
    callerId,
    memberships,
    rpcCalls: [],
    membershipDeletes: [],
    authUsersDeleted: [],
    tombstoned: false,
  }
}

function fakeFrom(table: string) {
  let op = 'select'
  let head = false
  const eqs: Record<string, unknown> = {}
  const chain: Record<string, unknown> = {}
  const run = (single: boolean) => {
    if (table === 'memberships') {
      if (op === 'delete') {
        state.membershipDeletes.push({ ...eqs })
        state.memberships = state.memberships.filter(
          (m) => !Object.entries(eqs).every(([k, v]) => (m as Record<string, unknown>)[k] === v)
        )
        return { data: null, error: null }
      }
      const rows = state.memberships.filter((m) =>
        Object.entries(eqs).every(([k, v]) => (m as Record<string, unknown>)[k] === v)
      )
      if (head) return { data: null, count: rows.length, error: null }
      return { data: rows, error: null }
    }
    if (table === 'users') {
      if (op === 'update') {
        state.tombstoned = true
        return { data: null, error: null }
      }
      const row = { id: eqs.id, email: 'target@example.com', full_name: 'Tal Target' }
      return single ? { data: row, error: null } : { data: [row], error: null }
    }
    if (table === 'agencies') return { data: { name: 'Agency' }, error: null }
    return { data: [], error: null }
  }
  for (const m of ['select', 'update', 'delete']) {
    chain[m] = (_v?: unknown, opts?: { head?: boolean }) => {
      op = m
      if (opts?.head) head = true
      return chain
    }
  }
  chain.eq = (k: string, v: unknown) => {
    eqs[k] = v
    return chain
  }
  chain.in = () => chain
  chain.single = async () => run(true)
  chain.then = (resolve: (v: unknown) => unknown) => resolve(run(false))
  return chain
}

const adminClient = {
  from: fakeFrom,
  rpc: async (fn: string, args: Record<string, unknown>) => {
    state.rpcCalls.push({ fn, args })
    return { data: 0, error: null }
  },
  auth: {
    admin: {
      deleteUser: async (id: string) => {
        state.authUsersDeleted.push(id)
        return { error: null }
      },
    },
  },
}

const cookieClient = {
  auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    getUser: async () => ({
      data: { user: { id: state.callerId, email: 'caller@example.com', user_metadata: {} } },
    }),
  },
}

const realFetch = globalThis.fetch
const savedEnv: Record<string, string | undefined> = {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabaseJs: any
let realCreateClient: unknown
let DELETE: (req: NextRequest, ctx: { params: { userId: string } }) => Promise<Response>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let requestStorage: any

function call(userId: string, query = ''): Promise<Response> {
  const req = new NextRequest(`http://localhost/api/users/${userId}/data${query}`, {
    method: 'DELETE',
  })
  const store = {
    cookies: { getAll: () => [], get: () => undefined, set: () => undefined },
    mutableCookies: { getAll: () => [], get: () => undefined, set: () => undefined },
    headers: new Headers(),
    draftMode: { isEnabled: false },
  }
  return requestStorage.run(store, () => DELETE(req, { params: { userId } }))
}

describe('DELETE /api/users/[userId]/data — behaviour', () => {
  before(async () => {
    for (const k of [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'RESEND_API_KEY',
    ]) {
      savedEnv[k] = process.env[k]
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake_token'
    delete process.env.RESEND_API_KEY // sendEmail then throws: email failure path

    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      const sent = JSON.parse(String(init?.body ?? '[]'))
      const payload = Array.isArray(sent[0]) ? sent.map(() => ({ result: 1 })) : { result: 1 }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const req = createRequire(import.meta.url)
    supabaseJs = req('@supabase/supabase-js')
    realCreateClient = supabaseJs.createClient
    supabaseJs.createClient = (_url: string, key: string) =>
      key === SERVICE ? adminClient : cookieClient
    // Next's request storage needs a global AsyncLocalStorage (provided by its runtime).
    ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
    requestStorage = req(
      'next/dist/client/components/request-async-storage.external'
    ).requestAsyncStorage
    ;({ DELETE } = await import('./route'))
  })

  after(() => {
    globalThis.fetch = realFetch
    supabaseJs.createClient = realCreateClient
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  beforeEach(() => {
    state = freshState(CALLER, [])
  })

  it('(a) caller who is not owner/admin_agent of the named agency: 403, no rpc', async () => {
    state = freshState(CALLER, [
      { user_id: CALLER, agency_id: AGENCY_X, role: 'owner' }, // owns an UNRELATED agency
      { user_id: CALLER, agency_id: AGENCY_A, role: 'agent' }, // only an agent in A
      { user_id: TARGET, agency_id: AGENCY_A, role: 'talent' },
    ])
    const res = await call(TARGET, `?agencyId=${AGENCY_A}`)
    assert.equal(res.status, 403)
    assert.equal(state.rpcCalls.length, 0)
    assert.equal(state.membershipDeletes.length, 0)
  })

  it('(b) admin_agent targeting an owner: 403, nothing deleted', async () => {
    state = freshState(CALLER, [
      { user_id: CALLER, agency_id: AGENCY_A, role: 'admin_agent' },
      { user_id: TARGET, agency_id: AGENCY_A, role: 'owner' },
      { user_id: '00000000-0000-4000-8000-0000000000f1', agency_id: AGENCY_A, role: 'owner' },
    ])
    const res = await call(TARGET, `?agencyId=${AGENCY_A}`)
    assert.equal(res.status, 403)
    assert.equal(state.rpcCalls.length, 0)
  })

  it('missing agencyId for a non-self call: 400', async () => {
    const res = await call(TARGET)
    assert.equal(res.status, 400)
    assert.equal(state.rpcCalls.length, 0)
  })

  it('(c)+(e) scoped removal of a talent in two agencies touches only the scoped agency; email failure still 200', async () => {
    state = freshState(CALLER, [
      { user_id: CALLER, agency_id: AGENCY_A, role: 'owner' },
      { user_id: TARGET, agency_id: AGENCY_A, role: 'talent' },
      { user_id: TARGET, agency_id: AGENCY_B, role: 'talent' },
    ])
    const res = await call(TARGET, `?agencyId=${AGENCY_A}`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { success: true })

    assert.equal(state.rpcCalls.length, 1)
    assert.equal(state.rpcCalls[0].fn, 'purge_talent_in_agency')
    assert.equal(state.rpcCalls[0].args.p_agency_id, AGENCY_A)
    assert.equal(state.rpcCalls[0].args.p_talent_id, TARGET)
    assert.deepEqual(state.membershipDeletes, [{ user_id: TARGET, agency_id: AGENCY_A }])
    assert.ok(
      state.memberships.some((m) => m.user_id === TARGET && m.agency_id === AGENCY_B),
      'membership in the other agency survives'
    )
    assert.deepEqual(state.authUsersDeleted, [])
    assert.equal(state.tombstoned, false, 'account is not erased')
  })

  it('(d) sole-owner target: 409, no rpc', async () => {
    state = freshState(TARGET, [{ user_id: TARGET, agency_id: AGENCY_A, role: 'owner' }])
    const res = await call(TARGET)
    assert.equal(res.status, 409)
    assert.equal(state.rpcCalls.length, 0)
    assert.deepEqual(state.authUsersDeleted, [])
  })

  it('self-erasure purges every agency and erases the account', async () => {
    state = freshState(TARGET, [
      { user_id: TARGET, agency_id: AGENCY_A, role: 'talent' },
      { user_id: TARGET, agency_id: AGENCY_B, role: 'talent' },
    ])
    const res = await call(TARGET)
    assert.equal(res.status, 200)
    assert.deepEqual(state.rpcCalls.map((c) => c.args.p_agency_id).sort(), [AGENCY_A, AGENCY_B])
    assert.deepEqual(state.authUsersDeleted, [TARGET])
    assert.equal(state.tombstoned, true)
  })
})
