/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deriveChecklist, getOnboardingChecklist } from '@/lib/onboarding-checklist'

const FUTURE = new Date(Date.now() + 86_400_000).toISOString()
const PAST = new Date(Date.now() - 86_400_000).toISOString()

describe('deriveChecklist', () => {
  const base = { members: [], invitations: [], hasVideoVersion: false }

  it('nothing done for an empty agency', () => {
    const r = deriveChecklist(base)
    assert.deepEqual(
      r.items.map((i) => i.done),
      [false, false, false]
    )
    assert.equal(r.allDone, false)
  })

  it('another agent / admin_agent member completes invite-agent', () => {
    assert.equal(deriveChecklist({ ...base, members: [{ role: 'agent' }] }).items[0].done, true)
    assert.equal(
      deriveChecklist({ ...base, members: [{ role: 'admin_agent' }] }).items[0].done,
      true
    )
    assert.equal(deriveChecklist({ ...base, members: [{ role: 'talent' }] }).items[0].done, false)
  })

  it('a talent member completes invite-talent only', () => {
    const r = deriveChecklist({ ...base, members: [{ role: 'talent' }] })
    assert.equal(r.items[1].done, true)
    assert.equal(r.items[0].done, false)
  })

  it('a pending (unexpired) invitation counts', () => {
    const r = deriveChecklist({
      ...base,
      invitations: [
        { role: 'agent', accepted_at: null, expires_at: FUTURE },
        { role: 'talent', accepted_at: null, expires_at: FUTURE },
      ],
    })
    assert.equal(r.items[0].done, true)
    assert.equal(r.items[1].done, true)
  })

  it('an expired, unaccepted invitation does not count', () => {
    const r = deriveChecklist({
      ...base,
      invitations: [{ role: 'agent', accepted_at: null, expires_at: PAST }],
    })
    assert.equal(r.items[0].done, false)
  })

  it('an accepted invitation counts even if past expiry', () => {
    const r = deriveChecklist({
      ...base,
      invitations: [{ role: 'talent', accepted_at: PAST, expires_at: PAST }],
    })
    assert.equal(r.items[1].done, true)
  })

  it('video version completes upload; allDone when all three', () => {
    const r = deriveChecklist({
      members: [{ role: 'agent' }, { role: 'talent' }],
      invitations: [],
      hasVideoVersion: true,
    })
    assert.equal(r.items[2].done, true)
    assert.equal(r.allDone, true)
  })

  it('items link to real actions', () => {
    const r = deriveChecklist(base)
    assert.deepEqual(
      r.items.map((i) => i.href),
      ['/settings/team', '/settings/team', '/upload']
    )
  })
})

const ok = (data: any): Resp => ({ data, error: null })
type Resp = { data: any; error: any }
type Entry = Resp | ((agencyId: string | undefined) => Resp)
function stub(map: Record<string, Entry>) {
  const filters: Record<string, Array<[string, unknown[]]>> = {}
  return {
    filters,
    from(table: string) {
      const log: Array<[string, unknown[]]> = (filters[table] ??= [])
      const chain: any = {}
      let eqAgency: string | undefined
      for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
        chain[m] = (...a: unknown[]) => {
          log.push([m, a])
          if (m === 'eq' && a[0] === 'agency_id') eqAgency = a[1] as string
          return chain
        }
      }
      chain.then = (res: (v: Resp) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(
          (() => {
            const e = map[table] ?? ok([])
            return typeof e === 'function' ? e(eqAgency) : e
          })()
        ).then(res, rej)
      return chain
    },
  } as any
}

describe('getOnboardingChecklist', () => {
  it('returns null for a non-owner (no owner membership)', async () => {
    const s = stub({ memberships: ok([]) })
    assert.equal(await getOnboardingChecklist({ supabase: s, userId: 'u1' }), null)
  })

  it('filters the owner lookup with explicit role equality', async () => {
    const s = stub({ memberships: ok([]) })
    await getOnboardingChecklist({ supabase: s, userId: 'u1' })
    assert.ok(
      s.filters.memberships.some(([m, a]: any) => m === 'eq' && a[0] === 'role' && a[1] === 'owner')
    )
  })

  it('returns the checklist for an owner with nothing done', async () => {
    const s = stub({
      memberships: ok([{ agency_id: 'a1', user_id: 'u1', role: 'owner' }]),
      invitations: ok([]),
      video_versions: ok([]),
    })
    const r = await getOnboardingChecklist({ supabase: s, userId: 'u1' })
    assert.ok(r)
    assert.equal(r.allDone, false)
    assert.equal(r.items[0].done, false)
  })

  it('shows partial progress', async () => {
    const s = stub({
      memberships: ok([
        { agency_id: 'a1', user_id: 'u1', role: 'owner' },
        { agency_id: 'a1', user_id: 'u2', role: 'agent' },
      ]),
      invitations: ok([]),
      video_versions: ok([]),
    })
    const r = await getOnboardingChecklist({ supabase: s, userId: 'u1' })
    assert.deepEqual(
      r?.items.map((i) => i.done),
      [true, false, false]
    )
  })

  it('returns null (hidden) when all three are done', async () => {
    const s = stub({
      memberships: ok([
        { agency_id: 'a1', user_id: 'u1', role: 'owner' },
        { agency_id: 'a1', user_id: 'u2', role: 'agent' },
        { agency_id: 'a1', user_id: 'u3', role: 'talent' },
      ]),
      invitations: ok([]),
      video_versions: ok([{ id: 'v1' }]),
    })
    assert.equal(await getOnboardingChecklist({ supabase: s, userId: 'u1' }), null)
  })

  const twoAgencies = (videos: Record<string, boolean>, aAgentInvited: boolean) =>
    stub({
      agencies: ok([
        { id: 'a1', name: 'Alpha' },
        { id: 'a2', name: 'Beta' },
      ]),
      memberships: ok([
        { agency_id: 'a1', user_id: 'u1', role: 'owner' },
        { agency_id: 'a2', user_id: 'u1', role: 'owner' },
        { agency_id: 'a1', user_id: 'u2', role: 'agent' },
        { agency_id: 'a1', user_id: 'u3', role: 'talent' },
        ...(aAgentInvited ? [{ agency_id: 'a2', user_id: 'u4', role: 'agent' }] : []),
      ]),
      invitations: ok([]),
      video_versions: (id) => ok(id && videos[id] ? [{ id: 'v' }] : []),
    })

  it('two agencies: A complete, B new shows B with its name', async () => {
    const r = await getOnboardingChecklist({
      supabase: twoAgencies({ a1: true }, false),
      userId: 'u1',
    })
    assert.equal(r?.agencyId, 'a2')
    assert.equal(r?.agencyName, 'Beta')
  })

  it('two agencies: A incomplete, B complete shows A', async () => {
    const s = stub({
      agencies: ok([
        { id: 'a1', name: 'Alpha' },
        { id: 'a2', name: 'Beta' },
      ]),
      memberships: ok([
        { agency_id: 'a1', user_id: 'u1', role: 'owner' },
        { agency_id: 'a2', user_id: 'u1', role: 'owner' },
        { agency_id: 'a2', user_id: 'u2', role: 'agent' },
        { agency_id: 'a2', user_id: 'u3', role: 'talent' },
      ]),
      invitations: ok([]),
      video_versions: (id) => ok(id === 'a2' ? [{ id: 'v' }] : []),
    })
    const r = await getOnboardingChecklist({ supabase: s, userId: 'u1' })
    assert.equal(r?.agencyId, 'a1')
    assert.equal(r?.agencyName, 'Alpha')
  })

  it('two agencies both complete hides the card', async () => {
    const s = stub({
      agencies: ok([]),
      memberships: ok([
        { agency_id: 'a1', user_id: 'u1', role: 'owner' },
        { agency_id: 'a2', user_id: 'u1', role: 'owner' },
        { agency_id: 'a1', user_id: 'u2', role: 'agent' },
        { agency_id: 'a1', user_id: 'u3', role: 'talent' },
        { agency_id: 'a2', user_id: 'u2', role: 'agent' },
        { agency_id: 'a2', user_id: 'u3', role: 'talent' },
      ]),
      invitations: ok([]),
      video_versions: ok([{ id: 'v' }]),
    })
    assert.equal(await getOnboardingChecklist({ supabase: s, userId: 'u1' }), null)
  })

  it('omits the agency name for a single-agency owner', async () => {
    const s = stub({
      agencies: ok([{ id: 'a1', name: 'Alpha' }]),
      memberships: ok([{ agency_id: 'a1', user_id: 'u1', role: 'owner' }]),
    })
    const r = await getOnboardingChecklist({ supabase: s, userId: 'u1' })
    assert.equal(r?.agencyName, null)
  })

  for (const failing of ['agencies', 'memberships', 'invitations', 'video_versions']) {
    it(`fails closed (hidden, logged) when the ${failing} query errors`, async () => {
      const map: Record<string, Entry> = {
        memberships: ok([{ agency_id: 'a1', user_id: 'u1', role: 'owner' }]),
        invitations: ok([]),
        video_versions: ok([]),
      }
      map[failing] = { data: null, error: { message: 'boom' } }
      const logged: unknown[][] = []
      const orig = console.error
      console.error = (...a: unknown[]) => void logged.push(a)
      try {
        const r = await getOnboardingChecklist({ supabase: stub(map), userId: 'u1' })
        assert.equal(r, null)
      } finally {
        console.error = orig
      }
      assert.equal(logged.length, 1)
    })
  }
})
