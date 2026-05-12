/**
 * Unit tests for lib/auth-helpers.ts — getCurrentUserRole.
 * Uses the Node.js built-in test runner.
 *
 * Run: npx tsx --test lib/auth-helpers.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { UserRole } from './auth-helpers'

// ---------------------------------------------------------------------------
// HIERARCHY logic tests (pure, no Supabase needed)
// ---------------------------------------------------------------------------

const HIERARCHY: UserRole[] = ['owner', 'admin_agent', 'agent', 'talent']

function resolveRole(roles: string[]): UserRole {
  if (roles.length === 0) return 'talent'
  const sorted = [...roles].sort(
    (a, b) => HIERARCHY.indexOf(a as UserRole) - HIERARCHY.indexOf(b as UserRole)
  )
  return sorted[0] as UserRole
}

describe('getCurrentUserRole — HIERARCHY ordering', () => {
  it('returns talent when no memberships exist', () => {
    assert.equal(resolveRole([]), 'talent')
  })

  it('returns the single role when there is one membership', () => {
    assert.equal(resolveRole(['agent']), 'agent')
  })

  it('picks owner over any other role', () => {
    assert.equal(resolveRole(['talent', 'agent', 'owner', 'admin_agent']), 'owner')
  })

  it('picks admin_agent over agent and talent', () => {
    assert.equal(resolveRole(['talent', 'agent', 'admin_agent']), 'admin_agent')
  })

  it('picks agent over talent', () => {
    assert.equal(resolveRole(['talent', 'agent']), 'agent')
  })

  it('returns talent when only talent memberships exist', () => {
    assert.equal(resolveRole(['talent', 'talent']), 'talent')
  })

  it('HIERARCHY has 4 entries ordered owner > admin_agent > agent > talent', () => {
    assert.deepEqual(HIERARCHY, ['owner', 'admin_agent', 'agent', 'talent'])
  })
})

// ---------------------------------------------------------------------------
// Stubbed Supabase client tests for getCurrentUserRole
// ---------------------------------------------------------------------------

type StubUser = { id: string; email: string; user_metadata: Record<string, string> }

function makeSupabaseStub(
  user: StubUser | null,
  memberships: Array<{ role: string; agency_id: string }>
) {
  return {
    auth: {
      getUser: async () => ({ data: { user } }),
    },
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: memberships, error: null }),
      }),
    }),
  }
}

describe('getCurrentUserRole — with stubbed Supabase client', () => {
  it('returns { user: null, role: talent, agency_ids: [] } when not authenticated', async () => {
    const { getCurrentUserRole } = await import('./auth-helpers')

    const stub = {
      auth: { getUser: async () => ({ data: { user: null } }) },
      // from() should not be called when user is null
      from: (): never => {
        throw new Error('should not be called')
      },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow Supabase shim
    const result = await getCurrentUserRole(stub as any)
    assert.equal(result.user, null)
    assert.equal(result.role, 'talent')
    assert.deepEqual(result.agency_ids, [])
  })

  it('returns correct role and agency_ids from memberships', async () => {
    const { getCurrentUserRole } = await import('./auth-helpers')

    const user: StubUser = { id: 'u1', email: 'a@b.com', user_metadata: {} }
    const memberships = [
      { role: 'agent', agency_id: 'ag1' },
      { role: 'admin_agent', agency_id: 'ag2' },
    ]

    const stub = makeSupabaseStub(user, memberships)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow Supabase shim
    const result = await getCurrentUserRole(stub as any)
    assert.equal(result.role, 'admin_agent') // highest privilege
    assert.deepEqual(result.agency_ids.sort(), ['ag1', 'ag2'])
  })

  it('returns owner when owner membership exists', async () => {
    const { getCurrentUserRole } = await import('./auth-helpers')

    const user: StubUser = { id: 'u2', email: 'x@y.com', user_metadata: {} }
    const memberships = [
      { role: 'talent', agency_id: 'ag1' },
      { role: 'owner', agency_id: 'ag1' },
    ]

    const stub = makeSupabaseStub(user, memberships)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow Supabase shim
    const result = await getCurrentUserRole(stub as any)
    assert.equal(result.role, 'owner')
  })

  it('defaults to talent when user has no memberships', async () => {
    const { getCurrentUserRole } = await import('./auth-helpers')

    const user: StubUser = { id: 'u3', email: 'z@z.com', user_metadata: {} }
    const stub = makeSupabaseStub(user, [])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow Supabase shim
    const result = await getCurrentUserRole(stub as any)
    assert.equal(result.role, 'talent')
    assert.deepEqual(result.agency_ids, [])
  })
})
