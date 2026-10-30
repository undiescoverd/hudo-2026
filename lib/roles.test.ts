/**
 * Unit tests for lib/roles.ts — the client-safe role list that gates
 * agent-only UI (e.g. GuestShareButton) to match requireAgentRole.
 *
 * Run: npx tsx --test lib/roles.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENT_PLUS_ROLES, isAgentPlusRole } from './roles'
import { AGENT_PLUS_ROLES as API_HELPERS_AGENT_PLUS_ROLES } from './api-helpers'

describe('isAgentPlusRole', () => {
  for (const role of ['owner', 'admin_agent', 'agent']) {
    it(`admits ${role}`, () => {
      assert.equal(isAgentPlusRole(role), true)
    })
  }

  it('rejects talent (guest-link API would 403 them)', () => {
    assert.equal(isAgentPlusRole('talent'), false)
  })

  it('rejects guest, unknown roles, null and undefined', () => {
    assert.equal(isAgentPlusRole('guest'), false)
    assert.equal(isAgentPlusRole('superuser'), false)
    assert.equal(isAgentPlusRole(''), false)
    assert.equal(isAgentPlusRole(null), false)
    assert.equal(isAgentPlusRole(undefined), false)
  })
})

describe('roles — single source of truth', () => {
  it('api-helpers re-exports the same AGENT_PLUS_ROLES list requireAgentRole uses', () => {
    assert.equal(API_HELPERS_AGENT_PLUS_ROLES, AGENT_PLUS_ROLES)
  })

  it('has no server-only imports (safe for use client components)', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const source = fs.readFileSync(path.resolve(dir, 'roles.ts'), 'utf8')
    assert.doesNotMatch(source, /^import /m)
  })
})
