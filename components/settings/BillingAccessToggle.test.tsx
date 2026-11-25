/**
 * BillingAccessToggle / BillingAccessList (S5-ADMIN-001).
 * Run: pnpm exec tsx --test components/settings/BillingAccessToggle.test.tsx
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BillingAccessList, BillingAccessToggle, submitBillingAccess } from './BillingAccessToggle'

const AG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const US = '22222222-2222-4222-8222-222222222222'

function fakeFetch(status: number, body: unknown, capture: { url?: string; init?: RequestInit }) {
  return (async (url: string, init?: RequestInit) => {
    capture.url = url
    capture.init = init
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
}

describe('submitBillingAccess', () => {
  it('PATCHes the per-person route with { enabled } and reports success', async () => {
    const cap: { url?: string; init?: RequestInit } = {}
    const r = await submitBillingAccess(AG, US, true, fakeFetch(200, {}, cap))
    assert.deepEqual(r, { ok: true, enabled: true })
    assert.equal(cap.url, `/api/agencies/${AG}/members/${US}/billing-access`)
    assert.equal(cap.init?.method, 'PATCH')
    assert.deepEqual(JSON.parse(String(cap.init?.body)), { enabled: true })
  })

  it('surfaces the server error message on a 4xx', async () => {
    const r = await submitBillingAccess(
      AG,
      US,
      true,
      fakeFetch(403, { error: 'Access denied' }, {})
    )
    assert.deepEqual(r, { ok: false, error: 'Access denied' })
  })

  it('falls back to a generic message and handles network failure', async () => {
    const generic = await submitBillingAccess(AG, US, false, fakeFetch(500, 'oops', {}))
    assert.equal(generic.ok, false)
    const down = await submitBillingAccess(AG, US, false, (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch)
    assert.deepEqual(down, { ok: false, error: 'Network error — please try again.' })
  })
})

describe('BillingAccessToggle rendering', () => {
  const render = (initialEnabled: boolean) =>
    renderToStaticMarkup(
      React.createElement(BillingAccessToggle, {
        agencyId: AG,
        userId: US,
        name: 'Ada Admin',
        initialEnabled,
      })
    )

  it('shows the granted state as a checked, labelled checkbox', () => {
    const html = render(true)
    assert.match(html, /checked/)
    assert.match(html, /aria-label="Billing access for Ada Admin"/)
    assert.match(html, /Can manage billing/)
  })

  it('shows the default (revoked) state unchecked', () => {
    const html = render(false)
    assert.doesNotMatch(html, /checked/)
    assert.match(html, /No billing access/)
  })
})

describe('BillingAccessList (team page, owner view)', () => {
  it('renders one toggle per admin agent passed in, reflecting each grant', () => {
    const html = renderToStaticMarkup(
      React.createElement(BillingAccessList, {
        agencyId: AG,
        admins: [
          { userId: US, name: 'Ada Admin', enabled: true },
          { userId: '33333333-3333-4333-8333-333333333333', name: 'Bo Boss', enabled: false },
        ],
      })
    )
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2)
    assert.match(html, /Ada Admin/)
    assert.match(html, /Bo Boss/)
    assert.equal((html.match(/Can manage billing/g) ?? []).length, 1)
  })

  it('renders an empty state and no toggles when there are no admin agents', () => {
    const html = renderToStaticMarkup(
      React.createElement(BillingAccessList, { agencyId: AG, admins: [] })
    )
    assert.match(html, /No admin agents/)
    assert.doesNotMatch(html, /type="checkbox"/)
  })
})
