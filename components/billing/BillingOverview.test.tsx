/**
 * BillingOverview: a billing-granted admin agent sees no plan-change controls (S5-ADMIN-001).
 * Run: pnpm exec tsx --test components/billing/BillingOverview.test.tsx
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BillingOverview as BillingOverviewType } from './BillingOverview'

// Sibling components rely on the classic JSX runtime; expose React for the tsx transform.
;(globalThis as { React?: unknown }).React = React
let BillingOverview: typeof BillingOverviewType
before(async () => {
  ;({ BillingOverview } = await import('./BillingOverview'))
})

const base = {
  agencyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  plan: 'starter',
  subscriptionStatus: 'active',
  currentPeriodEnd: '2027-01-01T00:00:00Z',
  hasStripeCustomer: true,
  agentCount: 2,
  talentCount: 5,
  storageUsedBytes: 1024,
  storageLimitBytes: 107_374_182_400,
  hasLegalData: true,
  hasDpa: true,
}

const render = (canChangePlan: boolean) =>
  renderToStaticMarkup(React.createElement(BillingOverview, { ...base, canChangePlan }))

describe('BillingOverview', () => {
  it('owner: upgrade cards and "Manage subscription" are shown', () => {
    const html = render(true)
    assert.match(html, /Upgrade plan/)
    assert.match(html, /Upgrade to /)
    assert.match(html, /Manage subscription/)
  })

  it('granted admin agent: no upgrade cards, payment-method wording, still sees plan and usage', () => {
    const html = render(false)
    assert.doesNotMatch(html, /Upgrade plan|Upgrade to /)
    assert.doesNotMatch(html, /Manage subscription/)
    assert.match(html, /Update payment method/)
    assert.match(html, /Usage/)
    assert.match(html, /Starter/)
  })
})
