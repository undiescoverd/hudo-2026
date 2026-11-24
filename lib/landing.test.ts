import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HOME_PATH, dashboardViewFor, videosListRedirectFor } from './landing'

describe('landing', () => {
  it('HOME_PATH is /dashboard', () => {
    assert.equal(HOME_PATH, '/dashboard')
  })

  for (const role of ['owner', 'admin_agent', 'agent']) {
    it(`${role} gets the agent view and keeps /videos`, () => {
      assert.equal(dashboardViewFor(role), 'agent')
      assert.equal(videosListRedirectFor(role), null)
    })
  }

  it('talent gets the talent view and /videos redirects home', () => {
    assert.equal(dashboardViewFor('talent'), 'talent')
    assert.equal(videosListRedirectFor('talent'), '/dashboard')
  })

  for (const role of ['guest', 'superadmin', '', 'OWNER', null, undefined]) {
    it(`unknown role ${JSON.stringify(role)} fails closed to the talent view`, () => {
      assert.equal(dashboardViewFor(role), 'talent')
      assert.equal(videosListRedirectFor(role), '/dashboard')
    })
  }
})
