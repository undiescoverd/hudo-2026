/**
 * Permission rule for billing access (S5-ADMIN-001).
 * Run: pnpm exec tsx --test lib/billing-access.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  canChangePlan,
  canGrantBillingAccess,
  canViewBilling,
  getBillingAccess,
  isBillingGrantTarget,
  getUserBillingAccess,
  requireBillingAccess,
} from './billing-access'

describe('getBillingAccess', () => {
  it('owner is always owner-level, flag irrelevant', () => {
    assert.equal(getBillingAccess({ role: 'owner' }), 'owner')
    assert.equal(getBillingAccess({ role: 'owner', can_manage_billing: false }), 'owner')
  })
  it('admin_agent needs the flag exactly true', () => {
    assert.equal(getBillingAccess({ role: 'admin_agent', can_manage_billing: true }), 'delegate')
    assert.equal(getBillingAccess({ role: 'admin_agent', can_manage_billing: false }), null)
    assert.equal(getBillingAccess({ role: 'admin_agent', can_manage_billing: null }), null)
    assert.equal(getBillingAccess({ role: 'admin_agent' }), null)
  })
  it('agent, talent, guest and unknown roles never get access, even with the flag set', () => {
    for (const role of ['agent', 'talent', 'guest', 'superuser', '']) {
      assert.equal(getBillingAccess({ role, can_manage_billing: true }), null, role)
    }
  })
  it('missing membership -> no access', () => {
    assert.equal(getBillingAccess(null), null)
    assert.equal(getBillingAccess(undefined), null)
  })
})

describe('view / change-plan split', () => {
  const owner = { role: 'owner' }
  const delegate = { role: 'admin_agent', can_manage_billing: true }
  const plain = { role: 'admin_agent', can_manage_billing: false }
  it('owner and delegate can view; plain admin cannot', () => {
    assert.equal(canViewBilling(owner), true)
    assert.equal(canViewBilling(delegate), true)
    assert.equal(canViewBilling(plain), false)
  })
  it('only the owner can change plan / cancel', () => {
    assert.equal(canChangePlan(owner), true)
    assert.equal(canChangePlan(delegate), false)
    assert.equal(canChangePlan(plain), false)
  })
})

describe('grant rules', () => {
  it('only owners may grant', () => {
    assert.equal(canGrantBillingAccess('owner'), true)
    for (const r of ['admin_agent', 'agent', 'talent', 'guest', 'x']) {
      assert.equal(canGrantBillingAccess(r), false, r)
    }
  })
  it('only admin agents are valid targets', () => {
    assert.equal(isBillingGrantTarget('admin_agent'), true)
    for (const r of ['owner', 'agent', 'talent', 'guest']) {
      assert.equal(isBillingGrantTarget(r), false, r)
    }
  })
})

function stubAdmin(result: { data: unknown; error: { message: string } | null }) {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.maybeSingle = async () => result
  return { from: () => chain } as unknown as SupabaseClient
}

describe('requireBillingAccess', () => {
  it('returns the access level for a delegate', async () => {
    const r = await requireBillingAccess(
      stubAdmin({ data: { role: 'admin_agent', can_manage_billing: true }, error: null }),
      'u',
      'a'
    )
    assert.deepEqual(r, { role: 'admin_agent', access: 'delegate' })
  })
  it('ownerOnly rejects a delegate with 403', async () => {
    const r = await requireBillingAccess(
      stubAdmin({ data: { role: 'admin_agent', can_manage_billing: true }, error: null }),
      'u',
      'a',
      { ownerOnly: true }
    )
    assert.equal((r as Response).status, 403)
  })
  it('no membership -> 403, DB error -> 500', async () => {
    const none = await requireBillingAccess(stubAdmin({ data: null, error: null }), 'u', 'a')
    assert.equal((none as Response).status, 403)
    const err = await requireBillingAccess(
      stubAdmin({ data: null, error: { message: 'boom' } }),
      'u',
      'a'
    )
    assert.equal((err as Response).status, 500)
  })
})

function stubList(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = async () => ({ data: rows, error: null })
  return { from: () => chain } as unknown as SupabaseClient
}

describe('getUserBillingAccess (header + settings nav)', () => {
  it('owner anywhere -> access, not a delegate', async () => {
    const r = await getUserBillingAccess(stubList([{ role: 'owner' }, { role: 'agent' }]), 'u')
    assert.deepEqual(r, { hasAccess: true, isDelegate: false })
  })
  it('granted admin agent -> access and delegate', async () => {
    const r = await getUserBillingAccess(
      stubList([{ role: 'admin_agent', can_manage_billing: true }]),
      'u'
    )
    assert.deepEqual(r, { hasAccess: true, isDelegate: true })
  })
  it('ungranted admin, agent, talent, or no memberships -> no access', async () => {
    for (const rows of [
      [{ role: 'admin_agent', can_manage_billing: false }],
      [{ role: 'agent', can_manage_billing: true }],
      [{ role: 'talent' }],
      [],
    ]) {
      assert.deepEqual(await getUserBillingAccess(stubList(rows), 'u'), {
        hasAccess: false,
        isDelegate: false,
      })
    }
  })
})
