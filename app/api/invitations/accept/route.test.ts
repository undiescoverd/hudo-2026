/**
 * Unit tests for POST /api/invitations/accept — a failed attempt must not burn the token.
 *
 * The Supabase admin client is replaced by a small stateful in-memory fake and the
 * Upstash REST call is stubbed via globalThis.fetch. Each test makes a failing
 * request, then retries with the SAME token and asserts the retry succeeds.
 *
 * Run: npx tsx --test "app/api/invitations/accept/route.test.ts"
 */

import assert from 'node:assert/strict'
import { describe, it, before, beforeEach, after } from 'node:test'
import { createRequire } from 'node:module'
import { NextRequest } from 'next/server'

const TOKEN = 'ab'.repeat(32)
const GOOD_PASSWORD = 'Str0ng!Passw0rd#2026'

interface State {
  invitation: { id: string; accepted_at: string | null; expires_at: string }
  users: Array<{ id: string; email: string }>
  memberships: number
  failCreateUser: boolean
  failUsersInsert: boolean
  duplicateMembership: boolean
  deletedAuthUsers: string[]
}

let state: State

function freshState(): State {
  return {
    invitation: {
      id: 'inv-1',
      accepted_at: null,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
    users: [],
    memberships: 0,
    failCreateUser: false,
    failUsersInsert: false,
    duplicateMembership: false,
    deletedAuthUsers: [],
  }
}

type Result = { data: unknown; error: { message: string; code?: string } | null }

function fakeFrom(table: string) {
  let op = 'select'
  let values: Record<string, unknown> = {}
  const filters: Array<[string, string, unknown]> = []
  const run = (): Result => {
    if (table === 'invitations') {
      const inv = state.invitation
      const row = {
        ...inv,
        email: 'new@example.com',
        role: 'agent',
        agency_id: 'agency-1',
      }
      if (op === 'select') return { data: [row], error: null }
      if (op === 'update') {
        const matches = filters.every(([kind, col, val]) => {
          const cur = inv[col as 'accepted_at' | 'expires_at' | 'id'] as string | null
          if (kind === 'is') return cur === val
          if (kind === 'gte') return cur !== null && cur >= (val as string)
          if (kind === 'eq' && col in inv) return cur === val
          return true
        })
        if (!matches) return { data: [], error: null }
        inv.accepted_at = values.accepted_at as string | null
        return { data: [row], error: null }
      }
    }
    if (table === 'users') {
      if (op === 'select') {
        const email = filters.find(([, c]) => c === 'email')?.[2]
        return { data: state.users.filter((u) => u.email === email), error: null }
      }
      if (op === 'insert') {
        if (state.failUsersInsert) return { data: null, error: { message: 'users insert boom' } }
        state.users.push({ id: values.id as string, email: values.email as string })
        return { data: null, error: null }
      }
    }
    if (table === 'memberships' && op === 'insert') {
      if (state.duplicateMembership) {
        return { data: null, error: { message: 'duplicate', code: '23505' } }
      }
      state.memberships++
      return { data: null, error: null }
    }
    return { data: null, error: null }
  }
  const builder: Record<string, unknown> = {
    select: () => builder,
    update: (v: Record<string, unknown>) => {
      op = 'update'
      values = v
      return builder
    },
    insert: (v: Record<string, unknown>) => {
      op = 'insert'
      values = v
      return builder
    },
    eq: (c: string, v: unknown) => (filters.push(['eq', c, v]), builder),
    is: (c: string, v: unknown) => (filters.push(['is', c, v]), builder),
    gte: (c: string, v: unknown) => (filters.push(['gte', c, v]), builder),
    limit: () => builder,
    single: () => Promise.resolve({ data: { full_name: 'New User' }, error: null }),
    then: (resolve: (r: Result) => unknown) => resolve(run()),
  }
  return builder
}

const fakeClient = {
  from: fakeFrom,
  auth: {
    admin: {
      createUser: async () =>
        state.failCreateUser
          ? { data: { user: null }, error: { message: 'createUser boom' } }
          : { data: { user: { id: 'auth-1' } }, error: null },
      deleteUser: async (id: string) => {
        state.deletedAuthUsers.push(id)
        return { error: null }
      },
    },
  },
}

const realFetch = globalThis.fetch
const savedEnv: Record<string, string | undefined> = {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabaseJs: any
let realCreateClient: unknown
let POST: (req: NextRequest) => Promise<Response>

function call(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify(body),
    })
  )
}

describe('POST /api/invitations/accept — retry after failure', () => {
  before(async () => {
    for (const k of [
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
    ]) {
      savedEnv[k] = process.env[k]
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role'
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake_token'

    // Upstash REST: INCR -> 1 (under the limit); auto-pipelined calls expect an array
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      const sent = JSON.parse(String(init?.body ?? '[]'))
      const payload = Array.isArray(sent[0]) ? sent.map(() => ({ result: 1 })) : { result: 1 }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    supabaseJs = createRequire(import.meta.url)('@supabase/supabase-js')
    realCreateClient = supabaseJs.createClient
    supabaseJs.createClient = () => fakeClient
    ;({ POST } = await import('./route'))
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
    state = freshState()
  })

  it('400 on missing password does not burn the token; retry succeeds', async () => {
    const first = await call({ token: TOKEN, fullName: 'New User' })
    assert.equal(first.status, 400)
    assert.equal(state.invitation.accepted_at, null)

    const retry = await call({ token: TOKEN, password: GOOD_PASSWORD, fullName: 'New User' })
    assert.equal(retry.status, 200)
    assert.deepEqual(await retry.json(), { success: true })
    assert.notEqual(state.invitation.accepted_at, null)
    assert.equal(state.memberships, 1)
  })

  it('createUser error (500) releases the claim; retry succeeds', async () => {
    state.failCreateUser = true
    const first = await call({ token: TOKEN, password: GOOD_PASSWORD, fullName: 'New User' })
    assert.equal(first.status, 500)
    assert.equal(state.invitation.accepted_at, null)

    state.failCreateUser = false
    const retry = await call({ token: TOKEN, password: GOOD_PASSWORD, fullName: 'New User' })
    assert.equal(retry.status, 200)
    assert.equal(state.memberships, 1)
  })

  it('users insert failure deletes the orphan auth user, releases the claim; retry succeeds', async () => {
    state.failUsersInsert = true
    const first = await call({ token: TOKEN, password: GOOD_PASSWORD, fullName: 'New User' })
    assert.equal(first.status, 500)
    assert.deepEqual(state.deletedAuthUsers, ['auth-1'])
    assert.equal(state.invitation.accepted_at, null)

    state.failUsersInsert = false
    const retry = await call({ token: TOKEN, password: GOOD_PASSWORD, fullName: 'New User' })
    assert.equal(retry.status, 200)
    assert.equal(state.memberships, 1)
  })

  it('duplicate membership (409) releases the claim; retry succeeds', async () => {
    state.users.push({ id: 'existing-1', email: 'new@example.com' })
    state.duplicateMembership = true
    const first = await call({ token: TOKEN })
    assert.equal(first.status, 409)
    assert.equal(state.invitation.accepted_at, null)

    state.duplicateMembership = false
    const retry = await call({ token: TOKEN })
    assert.equal(retry.status, 200)
    assert.equal(state.memberships, 1)
  })

  it('an already-accepted invitation still returns 410', async () => {
    state.invitation.accepted_at = new Date().toISOString()
    const res = await call({ token: TOKEN, password: GOOD_PASSWORD, fullName: 'New User' })
    assert.equal(res.status, 410)
  })
})
