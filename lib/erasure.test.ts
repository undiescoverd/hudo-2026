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
  }
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

  const admin = {
    from: (table: string) => {
      fromCalls.push(table)
      const chain = makeChain(tableConfigs[table] ?? {})
      chainsByTable[table] = chainsByTable[table] ?? []
      chainsByTable[table].push(chain)
      return chain
    },
    auth: { admin: { deleteUser: deleteUserMock } },
  }

  return { admin, chainsByTable, fromCalls, deleteUserMock }
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
