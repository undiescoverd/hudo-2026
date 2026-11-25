/**
 * AppHeader Billing link (S5-ADMIN-001): visible only with billing access, while billing is on.
 * Run: pnpm exec tsx --test components/layout/AppHeader.test.tsx
 */
import assert from 'node:assert/strict'
import { afterEach, before, describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AppHeader as AppHeaderType } from './AppHeader'

// Sibling components rely on the classic JSX runtime; expose React for the tsx transform.
;(globalThis as { React?: unknown }).React = React
let AppHeader: typeof AppHeaderType
before(async () => {
  ;({ AppHeader } = await import('./AppHeader'))
})

const original = process.env.NEXT_PUBLIC_BILLING_ENABLED
afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_BILLING_ENABLED
  else process.env.NEXT_PUBLIC_BILLING_ENABLED = original
})

const render = (role: string, hasBillingAccess: boolean) =>
  renderToStaticMarkup(
    React.createElement(AppHeader, { displayName: 'Test User', role, hasBillingAccess })
  )

describe('AppHeader Billing link', () => {
  it('shows Billing for a user with billing access (owner or granted admin agent)', () => {
    process.env.NEXT_PUBLIC_BILLING_ENABLED = 'true'
    assert.match(render('owner', true), /href="\/settings\/billing"/)
    assert.match(render('admin_agent', true), /href="\/settings\/billing"/)
  })

  it('hides Billing for an ungranted admin agent, agent and talent', () => {
    process.env.NEXT_PUBLIC_BILLING_ENABLED = 'true'
    for (const role of ['admin_agent', 'agent', 'talent']) {
      assert.doesNotMatch(render(role, false), /\/settings\/billing/, role)
    }
  })

  it('hides Billing for everyone while the billing flag is off', () => {
    process.env.NEXT_PUBLIC_BILLING_ENABLED = 'false'
    assert.doesNotMatch(render('owner', true), /\/settings\/billing/)
  })

  it('still shows Team for admin agents regardless of the grant', () => {
    process.env.NEXT_PUBLIC_BILLING_ENABLED = 'true'
    assert.match(render('admin_agent', false), /href="\/settings\/team"/)
  })
})
