/**
 * /settings/team — pending list filtering/rendering + page invariants.
 *
 * Run: npx tsx --test "app/(dashboard)/settings/team/page.test.tsx"
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { filterPendingInvitations } from '../../../../lib/invite-permissions.js'
import { PendingInvitations } from '../../../../components/settings/PendingInvitations.js'

const now = new Date('2026-10-23T12:00:00Z')
const rows = [
  {
    id: '1',
    email: 'pending@x.co',
    role: 'talent',
    expires_at: '2026-10-30T00:00:00Z',
    accepted_at: null,
  },
  {
    id: '2',
    email: 'expired@x.co',
    role: 'agent',
    expires_at: '2026-10-01T00:00:00Z',
    accepted_at: null,
  },
  {
    id: '3',
    email: 'accepted@x.co',
    role: 'agent',
    expires_at: '2026-10-30T00:00:00Z',
    accepted_at: '2026-10-22T00:00:00Z',
  },
]

describe('pending invitations list', () => {
  it('keeps only unaccepted, unexpired rows', () => {
    assert.deepEqual(
      filterPendingInvitations(rows, now).map((r) => r.id),
      ['1']
    )
  })

  it('renders email, role and expiry for pending rows only', () => {
    const html = renderToStaticMarkup(
      React.createElement(PendingInvitations, { invitations: filterPendingInvitations(rows, now) })
    )
    assert.match(html, /pending@x\.co/)
    assert.match(html, /talent/)
    assert.match(html, /2026-10-30/)
    assert.doesNotMatch(html, /expired@x\.co|accepted@x\.co/)
  })

  it('renders an empty state', () => {
    const html = renderToStaticMarkup(React.createElement(PendingInvitations, { invitations: [] }))
    assert.match(html, /No pending invitations/)
  })
})

describe('/settings/team page — invariants', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const source = fs.readFileSync(path.resolve(dir, 'page.tsx'), 'utf8')

  it('denies roles that cannot invite and scopes the query to the membership agency', () => {
    assert.match(source, /canInvite\(m\.role\)/)
    assert.match(source, /redirect\('\/videos'\)/)
    assert.match(source, /\.eq\('agency_id', membership\.agency_id\)/)
    assert.match(source, /\.is\('accepted_at', null\)/)
  })

  it('never selects token_hash or uses the service-role client', () => {
    assert.doesNotMatch(source, /token_hash|createAdminClient/)
  })
})

describe('settings nav', () => {
  it('AppHeader links Team only for roles that can invite', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const header = fs.readFileSync(
      path.resolve(dir, '../../../../components/layout/AppHeader.tsx'),
      'utf8'
    )
    assert.match(header, /canInvite\(role\) && \(\s*<Link href="\/settings\/team"/)
  })
})
