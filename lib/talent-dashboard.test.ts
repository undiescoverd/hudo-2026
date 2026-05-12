/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for lib/talent-dashboard.ts — getTalentVideos query builder.
 * Uses the Node.js built-in test runner.
 *
 * Run: npx tsx --test lib/talent-dashboard.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

type Call = {
  table: string
  select?: string
  filters: Array<{ method: string; args: unknown[] }>
}

/**
 * Creates a minimal Supabase stub that records the query chain.
 * Returns different data per call in order: videos, comment_reads, video_versions.
 */
function makeQueryStub(
  videoData: unknown[],
  readData: unknown[],
  commentData: unknown[]
): { supabase: unknown; calls: Call[] } {
  const calls: Call[] = []
  let callCount = 0

  const makeChain = (table: string, data: unknown[]): unknown => {
    const call: Call = { table, filters: [] }
    calls.push(call)

    const chain: Record<string, unknown> = {}
    const resolveWith = { data, error: null }

    const methods = ['select', 'eq', 'in', 'order', 'limit', 'is']
    for (const m of methods) {
      chain[m] = (...args: unknown[]) => {
        if (m === 'select') call.select = args[0] as string
        else call.filters.push({ method: m, args })
        return chain
      }
    }

    // Make chain thenable so await works
    chain.then = (resolve: (v: unknown) => void) => {
      resolve(resolveWith)
      return Promise.resolve(resolveWith)
    }

    Object.assign(chain, resolveWith)
    return chain
  }

  const supabase = {
    from: (table: string) => {
      callCount++
      // 1st call = videos, 2nd = comment_reads, 3rd = video_versions
      const data = callCount === 1 ? videoData : callCount === 2 ? readData : commentData
      return makeChain(table, data)
    },
  }

  return { supabase, calls }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getTalentVideos — early exit', async () => {
  it('returns [] with no DB call when agency_ids is empty', async () => {
    const { getTalentVideos } = await import('./talent-dashboard')
    const { supabase, calls } = makeQueryStub([], [], [])

    const result = await getTalentVideos({
      supabase: supabase as any,
      user_id: 'u1',
      agency_ids: [],
    })

    assert.deepEqual(result.data, [])
    assert.equal(result.error, null)
    assert.equal(calls.length, 0, 'should not call supabase when agency_ids is empty')
  })
})

describe('getTalentVideos — query builder shape', async () => {
  it('queries videos table with talent_id eq filter', async () => {
    const { getTalentVideos } = await import('./talent-dashboard')
    const { supabase, calls } = makeQueryStub([], [], [])

    await getTalentVideos({ supabase: supabase as any, user_id: 'u1', agency_ids: ['ag1'] })

    const videosCall = calls.find((c) => c.table === 'videos')
    assert.ok(videosCall, 'should query videos table')

    const eqFilter = videosCall!.filters.find((f) => f.method === 'eq')
    assert.ok(eqFilter, 'should have .eq() filter')
    assert.equal(eqFilter!.args[0], 'talent_id')
    assert.equal(eqFilter!.args[1], 'u1')
  })

  it('queries videos table with agency_id in filter', async () => {
    const { getTalentVideos } = await import('./talent-dashboard')
    const { supabase, calls } = makeQueryStub([], [], [])

    await getTalentVideos({
      supabase: supabase as any,
      user_id: 'u1',
      agency_ids: ['ag1', 'ag2'],
    })

    const videosCall = calls.find((c) => c.table === 'videos')!
    const inFilter = videosCall.filters.find(
      (f) =>
        f.method === 'in' && Array.isArray(f.args[1]) && (f.args[1] as string[]).includes('ag1')
    )
    assert.ok(inFilter, 'should have .in() filter for agency_id')
    assert.deepEqual(inFilter!.args[1], ['ag1', 'ag2'])
  })

  it('queries comment_reads with correct user_id eq filter', async () => {
    // Return one video so subsequent queries run
    const videoRow = {
      id: 'v1',
      title: 'Test',
      status: 'draft',
      thumbnail_r2_key: null,
      created_at: '2026-01-01T00:00:00Z',
      video_versions: [{ id: 'vv1', version_number: 1 }],
    }
    const { getTalentVideos } = await import('./talent-dashboard')
    const { supabase, calls } = makeQueryStub([videoRow], [], [])

    await getTalentVideos({ supabase: supabase as any, user_id: 'u1', agency_ids: ['ag1'] })

    const readsCall = calls.find((c) => c.table === 'comment_reads')
    assert.ok(readsCall, 'should query comment_reads table')

    const eqFilter = readsCall!.filters.find((f) => f.method === 'eq' && f.args[0] === 'user_id')
    assert.ok(eqFilter, 'should filter comment_reads by user_id')
    assert.equal(eqFilter!.args[1], 'u1')
  })

  it('filters comments by deleted_at IS NULL', async () => {
    const videoRow = {
      id: 'v1',
      title: 'Test',
      status: 'draft',
      thumbnail_r2_key: null,
      created_at: '2026-01-01T00:00:00Z',
      video_versions: [{ id: 'vv1', version_number: 1 }],
    }
    const { getTalentVideos } = await import('./talent-dashboard')
    const { supabase, calls } = makeQueryStub([videoRow], [], [])

    await getTalentVideos({ supabase: supabase as any, user_id: 'u1', agency_ids: ['ag1'] })

    const versionsCall = calls.find((c) => c.table === 'video_versions')
    assert.ok(versionsCall, 'should query video_versions table for comments')

    const isFilter = versionsCall!.filters.find((f) => f.method === 'is')
    assert.ok(isFilter, 'should have .is() filter for deleted_at')
    assert.equal(isFilter!.args[1], null)
  })
})

describe('getTalentVideos — unread count calculation', async () => {
  const videoRow = {
    id: 'v1',
    title: 'My Video',
    status: 'in_review',
    thumbnail_r2_key: null,
    created_at: '2026-01-01T00:00:00Z',
    video_versions: [
      { id: 'vv1', version_number: 2 },
      { id: 'vv2', version_number: 1 },
    ],
  }

  it('unread_count = 0 when last_seen_at >= all comment timestamps', async () => {
    const { getTalentVideos } = await import('./talent-dashboard')

    const readRows = [{ video_id: 'v1', last_seen_at: '2026-02-01T00:00:00Z' }]
    const commentRows = [
      {
        video_id: 'v1',
        comments: [
          { id: 'c1', created_at: '2026-01-10T00:00:00Z' },
          { id: 'c2', created_at: '2026-01-20T00:00:00Z' },
        ],
      },
    ]

    const { supabase } = makeQueryStub([videoRow], readRows, commentRows)
    const { data } = await getTalentVideos({
      supabase: supabase as any,
      user_id: 'u1',
      agency_ids: ['ag1'],
    })

    assert.equal(data[0]?.unread_count, 0, 'should be 0 when all comments predate last_seen_at')
  })

  it('unread_count = total comment count when no comment_reads row exists', async () => {
    const { getTalentVideos } = await import('./talent-dashboard')

    // No read rows → no marker for this video
    const readRows: unknown[] = []
    const commentRows = [
      {
        video_id: 'v1',
        comments: [
          { id: 'c1', created_at: '2026-01-10T00:00:00Z' },
          { id: 'c2', created_at: '2026-01-20T00:00:00Z' },
          { id: 'c3', created_at: '2026-01-25T00:00:00Z' },
        ],
      },
    ]

    const { supabase } = makeQueryStub([videoRow], readRows, commentRows)
    const { data } = await getTalentVideos({
      supabase: supabase as any,
      user_id: 'u1',
      agency_ids: ['ag1'],
    })

    assert.equal(data[0]?.unread_count, 3, 'should equal total comments when no read marker exists')
  })

  it('unread_count = only comments after last_seen_at', async () => {
    const { getTalentVideos } = await import('./talent-dashboard')

    const readRows = [{ video_id: 'v1', last_seen_at: '2026-01-15T00:00:00Z' }]
    const commentRows = [
      {
        video_id: 'v1',
        comments: [
          { id: 'c1', created_at: '2026-01-10T00:00:00Z' }, // before → read
          { id: 'c2', created_at: '2026-01-20T00:00:00Z' }, // after → unread
          { id: 'c3', created_at: '2026-01-25T00:00:00Z' }, // after → unread
        ],
      },
    ]

    const { supabase } = makeQueryStub([videoRow], readRows, commentRows)
    const { data } = await getTalentVideos({
      supabase: supabase as any,
      user_id: 'u1',
      agency_ids: ['ag1'],
    })

    assert.equal(data[0]?.unread_count, 2, 'should count only comments after last_seen_at')
  })

  it('picks the highest version_number as latest_version', async () => {
    const { getTalentVideos } = await import('./talent-dashboard')
    const { supabase } = makeQueryStub([videoRow], [], [])

    const { data } = await getTalentVideos({
      supabase: supabase as any,
      user_id: 'u1',
      agency_ids: ['ag1'],
    })

    assert.equal(data[0]?.latest_version, 2)
  })
})
