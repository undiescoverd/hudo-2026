/**
 * Unit tests for the talent roster query (B1).
 *
 * Run: npx tsx --test lib/talent-roster.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchTalentRoster, isAgentClassRole } from './talent-roster'

function fakeClient(result: { data: unknown; error: { message: string } | null }) {
  const log: { from?: string; select?: string; eq: [string, unknown][] } = { eq: [] }
  // Chainable + awaitable, like a PostgREST filter builder.
  const builder = {
    select(cols: string) {
      log.select = cols
      return builder
    },
    eq(col: string, val: unknown) {
      log.eq.push([col, val])
      return builder
    },
    then: (resolve: (v: typeof result) => unknown) => resolve(result),
  }
  const client = {
    from(table: string) {
      log.from = table
      return builder
    },
  }
  return { client: client as unknown as SupabaseClient, log }
}

describe('fetchTalentRoster', () => {
  it('filters memberships by agency + role talent using the hinted users embed', async () => {
    const { client, log } = fakeClient({
      data: [
        { users: { id: 'u2', full_name: 'Zed', email: 'z@x.test' } },
        { users: { id: 'u1', full_name: 'Amy', email: 'a@x.test' } },
        { users: null },
      ],
      error: null,
    })
    const roster = await fetchTalentRoster(client, 'ag-1')

    assert.equal(log.from, 'memberships')
    assert.match(log.select ?? '', /users!memberships_user_id_fkey\(id, full_name, email\)/)
    assert.deepEqual(log.eq, [
      ['agency_id', 'ag-1'],
      ['role', 'talent'],
    ])
    assert.deepEqual(roster, [
      { id: 'u1', fullName: 'Amy', email: 'a@x.test' },
      { id: 'u2', fullName: 'Zed', email: 'z@x.test' },
    ])
  })

  it('throws the Supabase error rather than returning an empty list', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'boom' } })
    await assert.rejects(fetchTalentRoster(client, 'ag-1'), /boom/)
  })

  it('returns an empty list for an agency with no talent', async () => {
    const { client } = fakeClient({ data: [], error: null })
    assert.deepEqual(await fetchTalentRoster(client, 'ag-1'), [])
  })
})

describe('isAgentClassRole', () => {
  it('is true for owner/admin_agent/agent, false for talent and unknown', () => {
    assert.equal(isAgentClassRole('owner'), true)
    assert.equal(isAgentClassRole('admin_agent'), true)
    assert.equal(isAgentClassRole('agent'), true)
    assert.equal(isAgentClassRole('talent'), false)
    assert.equal(isAgentClassRole(''), false)
  })
})
