import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { settingsNavItems } from './settings-nav-items.js'

const labels = (role: string, billing = true) => settingsNavItems(role, billing).map((i) => i.label)

describe('settingsNavItems', () => {
  it('talent sees only Notifications and Account', () => {
    assert.deepEqual(labels('talent'), ['Notifications', 'Account'])
  })
  it('owner sees Members, Billing, Notifications, Account', () => {
    assert.deepEqual(labels('owner'), ['Members', 'Billing', 'Notifications', 'Account'])
  })
  it('admin agent and agent see Members but not Billing', () => {
    assert.deepEqual(labels('admin_agent'), ['Members', 'Notifications', 'Account'])
    assert.deepEqual(labels('agent'), ['Members', 'Notifications', 'Account'])
  })
  it('hides Billing for owner when billing is disabled', () => {
    assert.deepEqual(labels('owner', false), ['Members', 'Notifications', 'Account'])
  })
  it('unknown role falls back to the least-privileged set', () => {
    assert.deepEqual(labels('nonsense'), ['Notifications', 'Account'])
  })
  it('granted admin agent sees Billing; ungranted does not', () => {
    const granted = settingsNavItems('admin_agent', true, true).map((i) => i.label)
    assert.deepEqual(granted, ['Members', 'Billing', 'Notifications', 'Account'])
    assert.deepEqual(labels('admin_agent'), ['Members', 'Notifications', 'Account'])
  })
  it('the grant flag never gives Billing to agent or talent', () => {
    assert.deepEqual(
      settingsNavItems('agent', true, true).map((i) => i.label),
      ['Members', 'Notifications', 'Account']
    )
    assert.deepEqual(
      settingsNavItems('talent', true, true).map((i) => i.label),
      ['Notifications', 'Account']
    )
  })
  it('a granted admin agent still loses Billing while billing is disabled', () => {
    assert.ok(!settingsNavItems('admin_agent', false, true).some((i) => i.label === 'Billing'))
  })
})
