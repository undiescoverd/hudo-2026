import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { agencyAllowsGuestLinks, guestLinksAllowed } from './agency-entitlement'

describe('guestLinksAllowed (S5-GUEST-003)', () => {
  it('only canceled ends guest links; every other value fails open', () => {
    const cases: Array<[string | null, boolean]> = [
      ['active', true],
      ['trialing', true],
      ['past_due', true],
      [null, true],
      ['some_future_status', true],
      ['canceled', false],
    ]
    for (const [status, expected] of cases) {
      assert.equal(guestLinksAllowed({ subscription_status: status }), expected, String(status))
    }
  })
})

function stub(result: { data: unknown; error: { message: string } | null }) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => result }) }),
    }),
  } as unknown as SupabaseClient
}

describe('agencyAllowsGuestLinks', () => {
  it('allows active, blocks canceled', async () => {
    assert.equal(
      await agencyAllowsGuestLinks(
        stub({ data: { subscription_status: 'active' }, error: null }),
        'a'
      ),
      true
    )
    assert.equal(
      await agencyAllowsGuestLinks(
        stub({ data: { subscription_status: 'canceled' }, error: null }),
        'a'
      ),
      false
    )
  })

  it('fails closed on lookup error and missing agency', async () => {
    assert.equal(
      await agencyAllowsGuestLinks(stub({ data: null, error: { message: 'boom' } }), 'a'),
      false
    )
    assert.equal(await agencyAllowsGuestLinks(stub({ data: null, error: null }), 'a'), false)
  })
})
