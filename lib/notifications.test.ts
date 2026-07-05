/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for lib/notifications.ts
 * Run: RESEND_API_KEY=re_test npx tsx --test lib/notifications.test.ts
 * (RESEND_API_KEY must be non-empty to avoid Resend constructor throw at import time)
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { sendEmail } from './email'

type EmailSender = typeof sendEmail

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

function makeAdminStub(responses: Record<string, unknown[]>, updatedIds: string[]) {
  return {
    from(table: string) {
      const data = responses[table] ?? []

      const chain: Record<string, unknown> = {}

      // All filter/select methods are chainable
      for (const m of ['select', 'is', 'eq', 'neq', 'in', 'order']) {
        chain[m] = () => chain
      }

      // Make chain awaitable (thenable)
      chain['then'] = (onfulfilled?: (result: { data: unknown[]; error: null }) => void) => {
        const result = { data, error: null }
        onfulfilled?.(result)
        return Promise.resolve(result)
      }

      // update().in() records the IDs being stamped with sent_at
      chain['update'] = () => ({
        in: (_col: string, ids: string[]) => {
          updatedIds.push(...ids)
          return Promise.resolve({ data: null, error: null })
        },
      })

      chain['insert'] = () => Promise.resolve({ data: null, error: null })

      return chain
    },
  }
}

// ---------------------------------------------------------------------------
// Integration test: 10 unsent notifications for 1 recipient → 1 email
// ---------------------------------------------------------------------------

describe('batchAndSendNotifications — 10 comments → 1 email', async () => {
  it('sends exactly 1 email and marks all 10 notifications as sent', async () => {
    const { batchAndSendNotifications } = await import('./notifications')

    const RECIPIENT_ID = 'user-r'
    const COMMENTER_ID = 'user-c'
    const VIDEO_ID = 'video-1'

    // Created 20 min ago — past the 15-min default batch window
    const createdAt = new Date(Date.now() - 20 * 60 * 1000).toISOString()

    const notifications = Array.from({ length: 10 }, (_, i) => ({
      id: `notif-${i}`,
      recipient_id: RECIPIENT_ID,
      video_id: VIDEO_ID,
      comment_id: `comment-${i}`,
      created_at: createdAt,
      agency_id: 'agency-1',
    }))

    const comments = Array.from({ length: 10 }, (_, i) => ({
      id: `comment-${i}`,
      content: `Test comment ${i}`,
      timestamp_seconds: i * 10,
      user_id: COMMENTER_ID,
    }))

    const updatedIds: string[] = []
    let emailCallCount = 0

    const mockEmailSender: EmailSender = async () => {
      emailCallCount++
      return { id: 'msg-001' } as any
    }

    const admin = makeAdminStub(
      {
        notifications,
        notification_preferences: [
          { user_id: RECIPIENT_ID, email_enabled: true, batch_window_minutes: 15 },
        ],
        users: [
          { id: RECIPIENT_ID, email: 'recipient@test.com', full_name: 'Test Recipient' },
          { id: COMMENTER_ID, full_name: 'Test Commenter' },
        ],
        videos: [{ id: VIDEO_ID, title: 'My Test Video', agency_id: 'agency-1' }],
        comments,
      },
      updatedIds
    )

    const result = await batchAndSendNotifications({
      admin: admin as unknown as SupabaseClient,
      emailSender: mockEmailSender,
    })

    assert.equal(emailCallCount, 1, 'should call sendEmail exactly once')
    assert.equal(result.sent, 1, 'should report 1 successful send')
    assert.equal(result.errors, 0, 'should report 0 errors')
    assert.equal(updatedIds.length, 10, 'should mark all 10 notifications as sent')
  })
})

describe('batchAndSendNotifications — batch window', async () => {
  it('skips notifications that are still within the batch window', async () => {
    const { batchAndSendNotifications } = await import('./notifications')

    const RECIPIENT_ID = 'user-r'
    // Created only 2 min ago — within the 15-min default window
    const recentlyCreated = new Date(Date.now() - 2 * 60 * 1000).toISOString()

    const notifications = [
      {
        id: 'notif-1',
        recipient_id: RECIPIENT_ID,
        video_id: 'video-1',
        comment_id: 'comment-1',
        created_at: recentlyCreated,
        agency_id: 'agency-1',
      },
    ]

    const updatedIds: string[] = []
    let emailCallCount = 0
    const mockEmailSender: EmailSender = async () => {
      emailCallCount++
      return { id: 'x' } as any
    }

    const admin = makeAdminStub(
      {
        notifications,
        notification_preferences: [
          { user_id: RECIPIENT_ID, email_enabled: true, batch_window_minutes: 15 },
        ],
        users: [{ id: RECIPIENT_ID, email: 'r@test.com', full_name: 'R' }],
        videos: [],
        comments: [],
      },
      updatedIds
    )

    const result = await batchAndSendNotifications({
      admin: admin as unknown as SupabaseClient,
      emailSender: mockEmailSender,
    })

    assert.equal(emailCallCount, 0, 'should not email — notification is within batch window')
    assert.equal(result.sent, 0)
    assert.equal(updatedIds.length, 0, 'should not mark anything as sent')
  })
})

describe('batchAndSendNotifications — email_enabled = false', async () => {
  it('skips recipients who have opted out', async () => {
    const { batchAndSendNotifications } = await import('./notifications')

    const createdAt = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    const notifications = [
      {
        id: 'notif-1',
        recipient_id: 'user-r',
        video_id: 'video-1',
        comment_id: 'comment-1',
        created_at: createdAt,
        agency_id: 'agency-1',
      },
    ]

    const updatedIds: string[] = []
    let emailCallCount = 0
    const mockEmailSender: EmailSender = async () => {
      emailCallCount++
      return { id: 'x' } as any
    }

    const admin = makeAdminStub(
      {
        notifications,
        notification_preferences: [
          { user_id: 'user-r', email_enabled: false, batch_window_minutes: 15 },
        ],
        users: [{ id: 'user-r', email: 'r@test.com', full_name: 'R' }],
        videos: [],
        comments: [],
      },
      updatedIds
    )

    const result = await batchAndSendNotifications({
      admin: admin as unknown as SupabaseClient,
      emailSender: mockEmailSender,
    })

    assert.equal(emailCallCount, 0, 'should not email opted-out recipient')
    assert.equal(result.sent, 0)
    assert.equal(updatedIds.length, 0)
  })
})

describe('batchAndSendNotifications — send failure', async () => {
  it('does NOT mark notifications as sent when sendEmail throws', async () => {
    const { batchAndSendNotifications } = await import('./notifications')

    const createdAt = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    const notifications = [
      {
        id: 'notif-fail-1',
        recipient_id: 'user-r',
        video_id: 'video-1',
        comment_id: 'comment-1',
        created_at: createdAt,
        agency_id: 'agency-1',
      },
    ]

    const updatedIds: string[] = []
    const failingEmailSender: EmailSender = async () => {
      throw new Error('Resend unavailable')
    }

    const admin = makeAdminStub(
      {
        notifications,
        notification_preferences: [
          { user_id: 'user-r', email_enabled: true, batch_window_minutes: 15 },
        ],
        users: [{ id: 'user-r', email: 'r@test.com', full_name: 'R' }],
        videos: [{ id: 'video-1', title: 'V', agency_id: 'agency-1' }],
        comments: [{ id: 'comment-1', content: 'c', timestamp_seconds: 0, user_id: 'user-c' }],
      },
      updatedIds
    )

    const result = await batchAndSendNotifications({
      admin: admin as unknown as SupabaseClient,
      emailSender: failingEmailSender,
    })

    assert.equal(result.errors, 1, 'should report 1 error')
    assert.equal(result.sent, 0)
    assert.equal(updatedIds.length, 0, 'should NOT mark notifications as sent')
  })
})

describe('batchAndSendNotifications — no unsent', async () => {
  it('returns { sent: 0, errors: 0 } when there is nothing to process', async () => {
    const { batchAndSendNotifications } = await import('./notifications')

    const updatedIds: string[] = []
    const admin = makeAdminStub({ notifications: [] }, updatedIds)
    const noopSender: EmailSender = async () => ({ id: 'x' }) as any

    const result = await batchAndSendNotifications({
      admin: admin as unknown as SupabaseClient,
      emailSender: noopSender,
    })

    assert.deepEqual(result, { sent: 0, errors: 0 })
  })
})

// ---------------------------------------------------------------------------
// enqueueUploadNotification (S4-UPLOAD-001 — talent self-upload status flip)
//
// enqueueUploadNotification always calls createAdminClient() internally
// (mirroring enqueueCommentNotification), so an optional `deps.admin` override
// — the same injectable-client shape already used by batchAndSendNotifications
// above — is threaded through purely for testability; real call sites never
// pass it. This lets us assert real query/insert behavior without any ESM
// module-mocking (not set up for this test runner — see lib/audit.test.ts).
// ---------------------------------------------------------------------------

type ChainCall = { method: string; args: unknown[] }

// `calls` is passed in (rather than owned by the chain) so the caller can hold
// a reference to it *before* enqueueUploadNotification runs — the chain is
// only constructed lazily inside admin.from('memberships'), which happens
// during the call, not at test-setup time.
function makeMembershipsChain(
  calls: ChainCall[],
  data: unknown[],
  error: { message: string } | null = null
) {
  const chain: any = {
    select: (...args: unknown[]) => {
      calls.push({ method: 'select', args })
      return chain
    },
    eq: (...args: unknown[]) => {
      calls.push({ method: 'eq', args })
      return chain
    },
    neq: (...args: unknown[]) => {
      calls.push({ method: 'neq', args })
      return chain
    },
    then: (resolve: (v: unknown) => unknown) => resolve({ data, error }),
  }
  return chain
}

function makeUploadAdmin(
  members: { user_id: string; role: string }[],
  opts: {
    membersError?: { message: string } | null
    insertError?: { message: string } | null
  } = {}
) {
  const insertedRows: Record<string, unknown>[] = []
  const fromCalls: string[] = []
  const membershipsCalls: ChainCall[] = []

  const admin = {
    from: (table: string) => {
      fromCalls.push(table)
      if (table === 'memberships') {
        return makeMembershipsChain(membershipsCalls, members, opts.membersError ?? null)
      }
      if (table === 'notifications') {
        return {
          insert: (rows: Record<string, unknown>[]) => {
            insertedRows.push(...rows)
            return Promise.resolve({ error: opts.insertError ?? null })
          },
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }

  return { admin, insertedRows, fromCalls, membershipsCalls }
}

describe('enqueueUploadNotification', () => {
  const AGENCY_ID = 'agency-1'
  const VIDEO_ID = 'video-1'
  const UPLOADER_ID = 'uploader-1'

  it('inserts only agent+ recipients (excludes talent) and scopes the query to exclude the uploader', async () => {
    const { enqueueUploadNotification } = await import('./notifications')

    const members = [
      { user_id: 'agent-1', role: 'agent' },
      { user_id: 'owner-1', role: 'owner' },
      { user_id: 'admin-1', role: 'admin_agent' },
      { user_id: 'talent-1', role: 'talent' },
    ]
    const { admin, insertedRows, membershipsCalls } = makeUploadAdmin(members)

    await enqueueUploadNotification(
      { agencyId: AGENCY_ID, videoId: VIDEO_ID, uploaderId: UPLOADER_ID },
      { admin: admin as unknown as SupabaseClient }
    )

    assert.deepEqual(insertedRows.map((r) => r.recipient_id).sort(), [
      'admin-1',
      'agent-1',
      'owner-1',
    ])
    assert.ok(
      insertedRows.every((r) => r.type === 'status_changed' && r.comment_id === null),
      'every row must be type status_changed with comment_id null'
    )
    assert.ok(
      membershipsCalls.some(
        (c: ChainCall) => c.method === 'neq' && c.args[0] === 'user_id' && c.args[1] === UPLOADER_ID
      ),
      'query must scope out the uploader via .neq(user_id, uploaderId)'
    )
  })

  it('no-ops when there are no members at all', async () => {
    const { enqueueUploadNotification } = await import('./notifications')
    const { admin, insertedRows, fromCalls } = makeUploadAdmin([])

    await enqueueUploadNotification(
      { agencyId: AGENCY_ID, videoId: VIDEO_ID, uploaderId: UPLOADER_ID },
      { admin: admin as unknown as SupabaseClient }
    )

    assert.equal(insertedRows.length, 0)
    assert.ok(!fromCalls.includes('notifications'), 'must not query notifications when no members')
  })

  it('no-ops when every member is talent (no eligible recipients)', async () => {
    const { enqueueUploadNotification } = await import('./notifications')
    const members = [
      { user_id: 'talent-1', role: 'talent' },
      { user_id: 'talent-2', role: 'talent' },
    ]
    const { admin, insertedRows } = makeUploadAdmin(members)

    await enqueueUploadNotification(
      { agencyId: AGENCY_ID, videoId: VIDEO_ID, uploaderId: UPLOADER_ID },
      { admin: admin as unknown as SupabaseClient }
    )

    assert.equal(insertedRows.length, 0)
  })

  it('never throws when the memberships query errors', async () => {
    const { enqueueUploadNotification } = await import('./notifications')
    const { admin, insertedRows } = makeUploadAdmin([], { membersError: { message: 'db down' } })

    await assert.doesNotReject(() =>
      enqueueUploadNotification(
        { agencyId: AGENCY_ID, videoId: VIDEO_ID, uploaderId: UPLOADER_ID },
        { admin: admin as unknown as SupabaseClient }
      )
    )
    assert.equal(insertedRows.length, 0)
  })

  it('never throws when the notifications insert errors', async () => {
    const { enqueueUploadNotification } = await import('./notifications')
    const members = [{ user_id: 'agent-1', role: 'agent' }]
    const { admin } = makeUploadAdmin(members, { insertError: { message: 'insert failed' } })

    await assert.doesNotReject(() =>
      enqueueUploadNotification(
        { agencyId: AGENCY_ID, videoId: VIDEO_ID, uploaderId: UPLOADER_ID },
        { admin: admin as unknown as SupabaseClient }
      )
    )
  })

  it('never throws on a config error (no deps.admin, createAdminClient throws in test env)', async () => {
    const { enqueueUploadNotification } = await import('./notifications')
    await assert.doesNotReject(() =>
      enqueueUploadNotification({ agencyId: AGENCY_ID, videoId: VIDEO_ID, uploaderId: UPLOADER_ID })
    )
  })
})
