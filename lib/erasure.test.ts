/**
 * Unit tests for lib/erasure.ts (S3-COMPLY-002 — GDPR right-to-erasure).
 *
 * All Supabase calls are mocked via a small chainable query-builder stub
 * (mirrors the mock-injection pattern in lib/audit.test.ts). Each mocked
 * `.from(table)` call returns a thenable chain object that resolves once
 * awaited, recording every `.select()/.update()/.delete()/.eq()` call so
 * assertions can inspect exactly what was sent to each table.
 *
 * Run: npx tsx --test lib/erasure.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import {
  eraseUser,
  removeMemberWithData,
  sendErasureEmails,
  canEraseUser,
  DELETED_USER_NAME,
  tombstoneEmail,
  type MembershipRecord,
} from './erasure.js'

const TARGET_ID = '00000000-0000-0000-0000-0000000000aa'
const CALLER_ID = '00000000-0000-0000-0000-0000000000bb'
const AGENCY_A = '00000000-0000-0000-0000-0000000000a1'
const AGENCY_B = '00000000-0000-0000-0000-0000000000a2'

// ---------------------------------------------------------------------------
// Mock query-builder chain
// ---------------------------------------------------------------------------

type ChainCall = { method: string; args: unknown[] }

type TableConfig = {
  selectData?: unknown[]
  selectError?: { message: string } | null
  updateError?: { message: string } | null
  deleteError?: { message: string } | null
}

function makeChain(config: TableConfig) {
  const calls: ChainCall[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    calls,
    select: (...args: unknown[]) => {
      calls.push({ method: 'select', args })
      return chain
    },
    update: (...args: unknown[]) => {
      calls.push({ method: 'update', args })
      return chain
    },
    delete: (...args: unknown[]) => {
      calls.push({ method: 'delete', args })
      return chain
    },
    eq: (...args: unknown[]) => {
      calls.push({ method: 'eq', args })
      return chain
    },
    // Makes the chain awaitable — `await admin.from('t').select().eq(...)`
    // resolves through this.
    then: (resolve: (v: unknown) => unknown) => {
      const verb = calls.find(
        (c) => c.method === 'select' || c.method === 'update' || c.method === 'delete'
      )?.method
      if (verb === 'select') {
        return resolve({ data: config.selectData ?? [], error: config.selectError ?? null })
      }
      if (verb === 'update') {
        return resolve({ error: config.updateError ?? null })
      }
      if (verb === 'delete') {
        return resolve({ error: config.deleteError ?? null })
      }
      return resolve({ data: null, error: null })
    },
  }
  return chain
}

type AdminOverrides = Partial<
  Record<
    | 'memberships'
    | 'users'
    | 'audit_log'
    | 'notifications'
    | 'notification_preferences'
    | 'comment_reads',
    TableConfig
  >
>

function makeAdmin(
  overrides: AdminOverrides = {},
  deleteUserResult: { error: { message: string; status?: number; code?: string } | null } = {
    error: null,
  },
  rpcError: { message: string } | null = null
) {
  const tableConfigs: Record<string, TableConfig> = {
    memberships: { selectData: [{ agency_id: AGENCY_A, role: 'agent' }] },
    users: {},
    audit_log: {},
    notifications: {},
    notification_preferences: {},
    comment_reads: {},
    ...overrides,
  }

  const chainsByTable: Record<string, ReturnType<typeof makeChain>[]> = {}
  const fromCalls: string[] = []
  const deleteUserMock = mock.fn(async () => deleteUserResult)
  const order: string[] = []
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []

  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      order.push(`rpc:${fn}`)
      rpcCalls.push({ fn, args })
      return { data: 0, error: rpcError }
    },
    from: (table: string) => {
      fromCalls.push(table)
      order.push(`from:${table}`)
      const chain = makeChain(tableConfigs[table] ?? {})
      chainsByTable[table] = chainsByTable[table] ?? []
      chainsByTable[table].push(chain)
      return chain
    },
    auth: { admin: { deleteUser: deleteUserMock } },
  }

  return { admin, chainsByTable, fromCalls, deleteUserMock, order, rpcCalls }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lib/erasure — tombstoneEmail / DELETED_USER_NAME', () => {
  it('produces a stable, non-deliverable tombstone email keyed on the user id', () => {
    assert.strictEqual(tombstoneEmail(TARGET_ID), `deleted-${TARGET_ID}@erased.invalid`)
  })

  it('DELETED_USER_NAME is the literal "Deleted User"', () => {
    assert.strictEqual(DELETED_USER_NAME, 'Deleted User')
  })
})

describe('lib/erasure — canEraseUser authorization matrix', () => {
  const m = (agency_id: string, role: string): MembershipRecord => ({ agency_id, role })

  it('self-erasure is always allowed (even with zero memberships on both sides)', () => {
    assert.strictEqual(canEraseUser(TARGET_ID, TARGET_ID, [], []), true)
  })

  it('owner in a shared agency may erase the target', () => {
    assert.strictEqual(
      canEraseUser(CALLER_ID, TARGET_ID, [m(AGENCY_A, 'owner')], [m(AGENCY_A, 'agent')]),
      true
    )
  })

  it('owner in a shared agency may erase a target who is elevated ELSEWHERE (accepted risk, documented)', () => {
    assert.strictEqual(
      canEraseUser(
        CALLER_ID,
        TARGET_ID,
        [m(AGENCY_A, 'owner')],
        [m(AGENCY_A, 'agent'), m(AGENCY_B, 'owner')]
      ),
      true
    )
  })

  it('admin_agent may erase an agent target who is not elevated anywhere', () => {
    assert.strictEqual(
      canEraseUser(CALLER_ID, TARGET_ID, [m(AGENCY_A, 'admin_agent')], [m(AGENCY_A, 'agent')]),
      true
    )
  })

  it('admin_agent may erase a talent target who is not elevated anywhere', () => {
    assert.strictEqual(
      canEraseUser(CALLER_ID, TARGET_ID, [m(AGENCY_A, 'admin_agent')], [m(AGENCY_A, 'talent')]),
      true
    )
  })

  it('EXPLOIT CASE: admin_agent is DENIED when target is agent in the shared agency but owner of an UNSHARED agency', () => {
    assert.strictEqual(
      canEraseUser(
        CALLER_ID,
        TARGET_ID,
        [m(AGENCY_A, 'admin_agent')],
        [m(AGENCY_A, 'agent'), m(AGENCY_B, 'owner')]
      ),
      false
    )
  })

  it('admin_agent is DENIED when target is admin_agent of an UNSHARED agency', () => {
    assert.strictEqual(
      canEraseUser(
        CALLER_ID,
        TARGET_ID,
        [m(AGENCY_A, 'admin_agent')],
        [m(AGENCY_A, 'talent'), m(AGENCY_B, 'admin_agent')]
      ),
      false
    )
  })

  it('admin_agent is DENIED when target is admin_agent in the shared agency', () => {
    assert.strictEqual(
      canEraseUser(
        CALLER_ID,
        TARGET_ID,
        [m(AGENCY_A, 'admin_agent')],
        [m(AGENCY_A, 'admin_agent')]
      ),
      false
    )
  })

  it('admin_agent is DENIED when target is owner in the shared agency', () => {
    assert.strictEqual(
      canEraseUser(CALLER_ID, TARGET_ID, [m(AGENCY_A, 'admin_agent')], [m(AGENCY_A, 'owner')]),
      false
    )
  })

  it('caller with no shared agency is denied regardless of roles', () => {
    assert.strictEqual(
      canEraseUser(CALLER_ID, TARGET_ID, [m(AGENCY_A, 'owner')], [m(AGENCY_B, 'agent')]),
      false
    )
  })

  it('empty target membership set is denied for any non-self caller', () => {
    assert.strictEqual(canEraseUser(CALLER_ID, TARGET_ID, [m(AGENCY_A, 'owner')], []), false)
  })

  it('non-elevated caller roles (agent/talent) in a shared agency are denied', () => {
    assert.strictEqual(
      canEraseUser(CALLER_ID, TARGET_ID, [m(AGENCY_A, 'agent')], [m(AGENCY_A, 'talent')]),
      false
    )
    assert.strictEqual(
      canEraseUser(CALLER_ID, TARGET_ID, [m(AGENCY_A, 'talent')], [m(AGENCY_A, 'talent')]),
      false
    )
  })
})

describe('lib/erasure — eraseUser happy path', () => {
  it('tombstones users: email, full_name, avatar_url — never DELETEs the row', async () => {
    const { admin, chainsByTable } = makeAdmin()
    const result = await eraseUser(admin as never, TARGET_ID)

    assert.strictEqual(result.ok, true)

    const usersChain = chainsByTable.users[0]
    const updateCall = usersChain.calls.find((c: ChainCall) => c.method === 'update')
    assert.ok(updateCall, 'users.update must be called')
    assert.deepStrictEqual(updateCall!.args[0], {
      email: tombstoneEmail(TARGET_ID),
      full_name: DELETED_USER_NAME,
      avatar_url: null,
    })

    const eqCall = usersChain.calls.find((c: ChainCall) => c.method === 'eq')
    assert.deepStrictEqual(eqCall!.args, ['id', TARGET_ID])

    assert.ok(
      !usersChain.calls.some((c: ChainCall) => c.method === 'delete'),
      'users row must never be DELETEd — see FK RESTRICT comment in erasure.ts'
    )
  })

  it('anonymises audit_log with the right filter and values', async () => {
    const { admin, chainsByTable } = makeAdmin()
    await eraseUser(admin as never, TARGET_ID)

    const auditChain = chainsByTable.audit_log[0]
    const updateCall = auditChain.calls.find((c: ChainCall) => c.method === 'update')
    assert.deepStrictEqual(updateCall!.args[0], {
      actor_name: DELETED_USER_NAME,
      actor_id: null,
    })

    const eqCall = auditChain.calls.find((c: ChainCall) => c.method === 'eq')
    assert.deepStrictEqual(eqCall!.args, ['actor_id', TARGET_ID])
  })

  it('deletes all 4 per-user tables with the correct key column', async () => {
    const { admin, chainsByTable } = makeAdmin()
    await eraseUser(admin as never, TARGET_ID)

    const membershipsDelete = chainsByTable.memberships.find((c) =>
      c.calls.some((call: ChainCall) => call.method === 'delete')
    )
    assert.ok(membershipsDelete, 'memberships must be deleted')
    assert.deepStrictEqual(
      membershipsDelete!.calls.find((c: ChainCall) => c.method === 'eq')!.args,
      ['user_id', TARGET_ID]
    )

    const notificationsDelete = chainsByTable.notifications[0]
    assert.deepStrictEqual(
      notificationsDelete.calls.find((c: ChainCall) => c.method === 'eq')!.args,
      ['recipient_id', TARGET_ID]
    )

    const notifPrefsDelete = chainsByTable.notification_preferences[0]
    assert.deepStrictEqual(notifPrefsDelete.calls.find((c: ChainCall) => c.method === 'eq')!.args, [
      'user_id',
      TARGET_ID,
    ])

    const commentReadsDelete = chainsByTable.comment_reads[0]
    assert.deepStrictEqual(
      commentReadsDelete.calls.find((c: ChainCall) => c.method === 'eq')!.args,
      ['user_id', TARGET_ID]
    )
  })

  it('calls auth.admin.deleteUser with the target id', async () => {
    const { admin, deleteUserMock } = makeAdmin()
    await eraseUser(admin as never, TARGET_ID)

    assert.strictEqual(deleteUserMock.mock.calls.length, 1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.strictEqual((deleteUserMock.mock.calls[0] as any).arguments[0], TARGET_ID)
  })

  it('returns agencyIds captured from the memberships snapshot taken at step 1', async () => {
    const { admin } = makeAdmin({
      memberships: {
        selectData: [
          { agency_id: AGENCY_A, role: 'agent' },
          { agency_id: AGENCY_B, role: 'owner' },
        ],
      },
    })
    const result = await eraseUser(admin as never, TARGET_ID)

    assert.strictEqual(result.ok, true)
    if (result.ok) {
      assert.deepStrictEqual(result.agencyIds, [AGENCY_A, AGENCY_B])
    }
  })
})

describe('lib/erasure — auth.admin.deleteUser 404 idempotency', () => {
  it('treats a 404 (status) deleteUser error as success', async () => {
    const { admin } = makeAdmin({}, { error: { message: 'User not found', status: 404 } })
    const result = await eraseUser(admin as never, TARGET_ID)
    assert.strictEqual(result.ok, true)
  })

  it('treats a user_not_found (code) deleteUser error as success', async () => {
    const { admin } = makeAdmin({}, { error: { message: 'not found', code: 'user_not_found' } })
    const result = await eraseUser(admin as never, TARGET_ID)
    assert.strictEqual(result.ok, true)
  })

  it('does NOT treat other deleteUser errors as success', async () => {
    const { admin } = makeAdmin({}, { error: { message: 'internal error', status: 500 } })
    const result = await eraseUser(admin as never, TARGET_ID)
    assert.strictEqual(result.ok, false)
    if (!result.ok) {
      assert.strictEqual(result.step, 'delete_auth_user')
    }
  })
})

describe('lib/erasure — per-step failure short-circuits', () => {
  it('capture_memberships failure stops before any writes', async () => {
    const { admin, chainsByTable } = makeAdmin({
      memberships: { selectError: { message: 'db down' } },
    })
    const result = await eraseUser(admin as never, TARGET_ID)

    assert.strictEqual(result.ok, false)
    if (!result.ok) assert.strictEqual(result.step, 'capture_memberships')
    assert.ok(!chainsByTable.users, 'users must never be touched')
  })

  it('tombstone_user failure stops before audit_log anonymisation', async () => {
    const { admin, chainsByTable } = makeAdmin({
      users: { updateError: { message: 'constraint violation' } },
    })
    const result = await eraseUser(admin as never, TARGET_ID)

    assert.strictEqual(result.ok, false)
    if (!result.ok) assert.strictEqual(result.step, 'tombstone_user')
    assert.ok(!chainsByTable.audit_log, 'audit_log must not be touched after tombstone fails')
  })

  it('anonymize_audit_log failure stops before per-user row deletions', async () => {
    const { admin, chainsByTable } = makeAdmin({
      audit_log: { updateError: { message: 'timeout' } },
    })
    const result = await eraseUser(admin as never, TARGET_ID)

    assert.strictEqual(result.ok, false)
    if (!result.ok) assert.strictEqual(result.step, 'anonymize_audit_log')
    assert.ok(!chainsByTable.notifications, 'notifications must not be touched')
  })

  it('delete_memberships failure stops before notifications deletion', async () => {
    const { admin, chainsByTable } = makeAdmin({
      memberships: {
        selectData: [{ agency_id: AGENCY_A, role: 'agent' }],
        deleteError: { message: 'fk violation' },
      },
    })
    const result = await eraseUser(admin as never, TARGET_ID)

    assert.strictEqual(result.ok, false)
    if (!result.ok) assert.strictEqual(result.step, 'delete_memberships')
    assert.ok(!chainsByTable.notifications, 'notifications must not be touched')
  })

  it('delete_notifications failure stops before notification_preferences deletion', async () => {
    const { admin, chainsByTable } = makeAdmin({
      notifications: { deleteError: { message: 'fk violation' } },
    })
    const result = await eraseUser(admin as never, TARGET_ID)

    assert.strictEqual(result.ok, false)
    if (!result.ok) assert.strictEqual(result.step, 'delete_notifications')
    assert.ok(
      !chainsByTable.notification_preferences,
      'notification_preferences must not be touched'
    )
  })

  it('delete_notification_preferences failure stops before comment_reads deletion', async () => {
    const { admin, chainsByTable } = makeAdmin({
      notification_preferences: { deleteError: { message: 'fk violation' } },
    })
    const result = await eraseUser(admin as never, TARGET_ID)

    assert.strictEqual(result.ok, false)
    if (!result.ok) assert.strictEqual(result.step, 'delete_notification_preferences')
    assert.ok(!chainsByTable.comment_reads, 'comment_reads must not be touched')
  })

  it('delete_comment_reads failure stops before auth.admin.deleteUser', async () => {
    const { admin, deleteUserMock } = makeAdmin({
      comment_reads: { deleteError: { message: 'fk violation' } },
    })
    const result = await eraseUser(admin as never, TARGET_ID)

    assert.strictEqual(result.ok, false)
    if (!result.ok) assert.strictEqual(result.step, 'delete_comment_reads')
    assert.strictEqual(deleteUserMock.mock.calls.length, 0, 'deleteUser must not be called')
  })
})

// ---------------------------------------------------------------------------
// S4-ERASE-001 — video purge, agency-scoped removal, emails
// ---------------------------------------------------------------------------

const ACTOR = { id: CALLER_ID, name: 'Olivia Owner' }

describe('lib/erasure — eraseUser purges the talent videos everywhere (D12, D13 self)', () => {
  it('calls purge_talent_in_agency once per membership agency, before the tombstone', async () => {
    const { admin, order, rpcCalls } = makeAdmin({
      memberships: {
        selectData: [
          { agency_id: AGENCY_A, role: 'talent' },
          { agency_id: AGENCY_B, role: 'talent' },
        ],
      },
    })
    const result = await eraseUser(admin as never, TARGET_ID)

    assert.strictEqual(result.ok, true)
    assert.deepStrictEqual(
      rpcCalls.map((c) => [c.fn, c.args.p_agency_id]),
      [
        ['purge_talent_in_agency', AGENCY_A],
        ['purge_talent_in_agency', AGENCY_B],
      ]
    )
    for (const c of rpcCalls) {
      assert.strictEqual(c.args.p_talent_id, TARGET_ID)
      assert.strictEqual(c.args.p_actor_id, null)
      assert.strictEqual(c.args.p_actor_name, 'GDPR erasure')
    }
    const lastRpc = order.lastIndexOf('rpc:purge_talent_in_agency')
    assert.ok(lastRpc > -1 && lastRpc < order.indexOf('from:users'), 'purge must precede tombstone')
  })

  it('an rpc error stops erasure at purge_talent_videos (no tombstone, no auth delete)', async () => {
    const { admin, chainsByTable, deleteUserMock } = makeAdmin(
      {},
      { error: null },
      { message: 'boom' }
    )
    const result = await eraseUser(admin as never, TARGET_ID)

    assert.deepStrictEqual(result, { ok: false, step: 'purge_talent_videos', message: 'boom' })
    assert.strictEqual(chainsByTable.users, undefined)
    assert.strictEqual(deleteUserMock.mock.calls.length, 0)
  })

  it('zero memberships means no rpc call', async () => {
    const { admin, rpcCalls } = makeAdmin({ memberships: { selectData: [] } })
    const result = await eraseUser(admin as never, TARGET_ID)
    assert.strictEqual(result.ok, true)
    assert.strictEqual(rpcCalls.length, 0)
  })
})

describe('lib/erasure — removeMemberWithData (D13 agency-scoped)', () => {
  it('scoped removal leaves the other agency intact: rpc for A only, account kept', async () => {
    const { admin, rpcCalls, chainsByTable, deleteUserMock } = makeAdmin({
      // first select = remaining memberships after the scoped delete
      memberships: { selectData: [{ agency_id: AGENCY_B, role: 'talent' }] },
    })
    const result = await removeMemberWithData(admin as never, TARGET_ID, AGENCY_A, ACTOR)

    assert.deepStrictEqual(result, { ok: true, agencyIds: [AGENCY_A], accountErased: false })
    assert.strictEqual(rpcCalls.length, 1)
    assert.strictEqual(rpcCalls[0].args.p_agency_id, AGENCY_A)
    assert.strictEqual(rpcCalls[0].args.p_actor_id, ACTOR.id)
    assert.strictEqual(rpcCalls[0].args.p_actor_name, ACTOR.name)

    const del = chainsByTable.memberships.find((c) =>
      c.calls.some((x: ChainCall) => x.method === 'delete')
    )
    const eqs = del!.calls.filter((c: ChainCall) => c.method === 'eq').map((c: ChainCall) => c.args)
    assert.deepStrictEqual(eqs, [
      ['user_id', TARGET_ID],
      ['agency_id', AGENCY_A],
    ])
    assert.strictEqual(deleteUserMock.mock.calls.length, 0, 'account must not be erased')
    assert.strictEqual(chainsByTable.users, undefined, 'users row must not be tombstoned')
  })

  it('a target only in this agency has the whole account erased (accountErased: true)', async () => {
    const { admin, deleteUserMock, chainsByTable } = makeAdmin({
      memberships: { selectData: [] },
    })
    const result = await removeMemberWithData(admin as never, TARGET_ID, AGENCY_A, ACTOR)

    assert.deepStrictEqual(result, { ok: true, agencyIds: [AGENCY_A], accountErased: true })
    assert.strictEqual(deleteUserMock.mock.calls.length, 1)
    assert.ok(chainsByTable.users, 'users row tombstoned')
  })

  it('purge rpc error stops before the membership is deleted', async () => {
    const { admin, chainsByTable } = makeAdmin({}, { error: null }, { message: 'nope' })
    const result = await removeMemberWithData(admin as never, TARGET_ID, AGENCY_A, ACTOR)
    assert.deepStrictEqual(result, { ok: false, step: 'purge_talent_videos', message: 'nope' })
    assert.strictEqual(chainsByTable.memberships, undefined)
  })

  it('membership delete failure is reported', async () => {
    const { admin } = makeAdmin({ memberships: { deleteError: { message: 'fk' } } })
    const result = await removeMemberWithData(admin as never, TARGET_ID, AGENCY_A, ACTOR)
    assert.deepStrictEqual(result, { ok: false, step: 'delete_membership', message: 'fk' })
  })
})

describe('lib/erasure — comments on others videos show "Deleted User" after erasure', () => {
  it('eraseUser never touches comments; rowToComment surfaces the tombstoned name with text kept', async () => {
    const { admin, fromCalls } = makeAdmin()
    await eraseUser(admin as never, TARGET_ID)
    assert.ok(!fromCalls.includes('comments'), 'comments rows must be left untouched')

    const { rowToComment } = await import('./comments.js')
    const c = rowToComment({
      id: 'c1',
      user_id: TARGET_ID,
      content: 'keep my words',
      users: { full_name: DELETED_USER_NAME, avatar_url: null },
    })
    assert.strictEqual(c.authorName, 'Deleted User')
    assert.strictEqual(c.content, 'keep my words')
  })
})

describe('lib/erasure — sendErasureEmails (D15)', () => {
  const target = { id: TARGET_ID, email: 'tal@example.com', fullName: 'Tal Ent' }

  function makeEmailAdmin() {
    return {
      from: (table: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          neq: () => chain,
          single: async () => ({ data: { name: 'Acme Talent' }, error: null }),
          then: (resolve: (v: unknown) => unknown) =>
            resolve(
              table === 'memberships'
                ? { data: [{ user_id: 'o1' }, { user_id: TARGET_ID }], error: null }
                : { data: [{ id: 'o1', email: 'owner@example.com' }], error: null }
            ),
        }
        return chain
      },
    }
  }

  it('self erasure sends the confirmation only, to the target', async () => {
    const sent: { to: unknown; subject: string }[] = []
    await sendErasureEmails(
      makeEmailAdmin() as never,
      { target, agencyId: null, accountErased: true },
      async (m) => void sent.push(m as never)
    )
    assert.deepStrictEqual(
      sent.map((s) => s.to),
      ['tal@example.com']
    )
  })

  it('scoped removal sends confirmation to the target and a receipt to the owners (not the target)', async () => {
    const sent: { to: unknown; subject: string }[] = []
    await sendErasureEmails(
      makeEmailAdmin() as never,
      { target, agencyId: AGENCY_A, accountErased: false },
      async (m) => void sent.push(m as never)
    )
    assert.deepStrictEqual(
      sent.map((s) => s.to),
      ['tal@example.com', ['owner@example.com']]
    )
  })

  it('an email that throws never throws out of sendErasureEmails, and later emails still send', async () => {
    let calls = 0
    await assert.doesNotReject(
      sendErasureEmails(
        makeEmailAdmin() as never,
        { target, agencyId: AGENCY_A, accountErased: false },
        async () => {
          calls++
          throw new Error('resend down')
        }
      )
    )
    assert.strictEqual(calls, 2)
  })

  it('a null target email skips the confirmation without throwing', async () => {
    const sent: unknown[] = []
    await sendErasureEmails(
      makeEmailAdmin() as never,
      { target: { ...target, email: null }, agencyId: null, accountErased: true },
      async (m) => void sent.push(m)
    )
    assert.strictEqual(sent.length, 0)
  })
})

describe('lib/erasure — canEraseUser scoped to a single agency (D13)', () => {
  const inA = (ms: MembershipRecord[]) => ms.filter((m) => m.agency_id === AGENCY_A)

  it('an admin_agent cannot remove an owner of that agency', () => {
    assert.strictEqual(
      canEraseUser(
        CALLER_ID,
        TARGET_ID,
        [{ agency_id: AGENCY_A, role: 'admin_agent' }],
        [{ agency_id: AGENCY_A, role: 'owner' }]
      ),
      false
    )
  })

  it('a plain agent cannot remove anyone', () => {
    assert.strictEqual(
      canEraseUser(
        CALLER_ID,
        TARGET_ID,
        [{ agency_id: AGENCY_A, role: 'agent' }],
        [{ agency_id: AGENCY_A, role: 'talent' }]
      ),
      false
    )
  })

  it('an owner of A can remove a talent from A even though the talent is also in B (B filtered out)', () => {
    const caller: MembershipRecord[] = [{ agency_id: AGENCY_A, role: 'owner' }]
    const target: MembershipRecord[] = [
      { agency_id: AGENCY_A, role: 'talent' },
      { agency_id: AGENCY_B, role: 'talent' },
    ]
    assert.strictEqual(canEraseUser(CALLER_ID, TARGET_ID, inA(caller), inA(target)), true)
  })

  it('an owner of A cannot scope a removal to agency B (no membership in scope -> denied)', () => {
    const inB = (ms: MembershipRecord[]) => ms.filter((m) => m.agency_id === AGENCY_B)
    const caller: MembershipRecord[] = [{ agency_id: AGENCY_A, role: 'owner' }]
    const target: MembershipRecord[] = [{ agency_id: AGENCY_B, role: 'talent' }]
    assert.strictEqual(canEraseUser(CALLER_ID, TARGET_ID, inB(caller), inB(target)), false)
  })
})
