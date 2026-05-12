/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for lib/dashboard.ts — getAgencyVideos query builder shape.
 * Uses the Node.js built-in test runner.
 *
 * Run: npx tsx --test lib/dashboard.test.ts
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
 * Creates a minimal Supabase stub that records the query chain
 * and returns the provided data.
 */
function makeQueryStub(
  videoData: unknown[],
  commentData: unknown[]
): { supabase: unknown; calls: Call[] } {
  const calls: Call[] = []

  let callCount = 0

  const makeChain = (table: string, data: unknown[]): unknown => {
    const call: Call = { table, filters: [] }
    calls.push(call)

    const chain: Record<string, unknown> = {}

    const resolveWith = { data, error: null }

    // All chain methods return the same chain (or resolve)
    const methods = ['select', 'in', 'order', 'range', 'ilike', 'is']
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

    // Make chain awaitable via Promise protocol
    Object.assign(chain, resolveWith)

    return chain
  }

  const supabase = {
    from: (table: string) => {
      callCount++
      // First call = videos query, second = comment count query
      const data = callCount === 1 ? videoData : commentData
      return makeChain(table, data)
    },
  }

  return { supabase, calls }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getAgencyVideos — returns empty array when no agency_ids', async () => {
  it('returns empty data for empty agency_ids', async () => {
    const { getAgencyVideos } = await import('./dashboard')
    const { supabase } = makeQueryStub([], [])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getAgencyVideos({ supabase: supabase as any, agency_ids: [] })
    assert.deepEqual(result.data, [])
    assert.equal(result.error, null)
  })
})

describe('getAgencyVideos — query builder shape', async () => {
  it('queries the videos table with correct agency_id filter', async () => {
    const { getAgencyVideos } = await import('./dashboard')
    const { supabase, calls } = makeQueryStub([], [])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getAgencyVideos({ supabase: supabase as any, agency_ids: ['ag1', 'ag2'] })

    const videosCall = calls.find((c) => c.table === 'videos')
    assert.ok(videosCall, 'should query videos table')

    const inFilter = videosCall!.filters.find((f) => f.method === 'in')
    assert.ok(inFilter, 'should have .in() filter for agency_id')
    assert.deepEqual(inFilter!.args[1], ['ag1', 'ag2'])
  })

  it('applies status filter when provided', async () => {
    const { getAgencyVideos } = await import('./dashboard')
    const { supabase, calls } = makeQueryStub([], [])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getAgencyVideos({
      supabase: supabase as any,
      agency_ids: ['ag1'],
      status: ['draft', 'in_review'],
    })

    const videosCall = calls.find((c) => c.table === 'videos')!
    const statusFilter = videosCall.filters.find(
      (f) => f.method === 'in' && (f.args[1] as string[]).includes('draft')
    )
    assert.ok(statusFilter, 'should apply status filter')
  })

  it('applies ilike title search when q is provided', async () => {
    const { getAgencyVideos } = await import('./dashboard')
    const { supabase, calls } = makeQueryStub([], [])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getAgencyVideos({
      supabase: supabase as any,
      agency_ids: ['ag1'],
      q: 'test video',
    })

    const videosCall = calls.find((c) => c.table === 'videos')!
    const ilikeFilter = videosCall.filters.find((f) => f.method === 'ilike')
    assert.ok(ilikeFilter, 'should apply ilike filter for title search')
    assert.ok((ilikeFilter!.args[1] as string).includes('test video'))
  })

  it('does NOT apply ilike filter when q is empty', async () => {
    const { getAgencyVideos } = await import('./dashboard')
    const { supabase, calls } = makeQueryStub([], [])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getAgencyVideos({
      supabase: supabase as any,
      agency_ids: ['ag1'],
      q: '   ',
    })

    const videosCall = calls.find((c) => c.table === 'videos')!
    const ilikeFilter = videosCall.filters.find((f) => f.method === 'ilike')
    assert.equal(ilikeFilter, undefined, 'should not apply ilike for whitespace-only q')
  })

  it('selects full_name from users join and version_number from video_versions', async () => {
    const { getAgencyVideos } = await import('./dashboard')
    const { supabase, calls } = makeQueryStub([], [])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getAgencyVideos({ supabase: supabase as any, agency_ids: ['ag1'] })

    const videosCall = calls.find((c) => c.table === 'videos')!
    assert.ok(videosCall.select?.includes('full_name'), 'select should include full_name')
    assert.ok(videosCall.select?.includes('version_number'), 'select should include version_number')
  })

  it('does NOT apply status filter when status array is empty', async () => {
    const { getAgencyVideos } = await import('./dashboard')
    const { supabase, calls } = makeQueryStub([], [])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getAgencyVideos({
      supabase: supabase as any,
      agency_ids: ['ag1'],
      status: [],
    })

    const videosCall = calls.find((c) => c.table === 'videos')!
    // The only .in() should be for agency_id, not status
    const inFilters = videosCall.filters.filter((f) => f.method === 'in')
    const statusInFilter = inFilters.find(
      (f) =>
        (f.args[1] as string[]).includes?.('draft') ||
        (f.args[1] as string[]).includes?.('approved')
    )
    assert.equal(statusInFilter, undefined, 'should not apply status in-filter for empty array')
  })
})

describe('getAgencyVideos — data transformation', async () => {
  const sampleVideoRow = {
    id: 'v1',
    title: 'My Video',
    status: 'in_review',
    thumbnail_r2_key: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-05T00:00:00Z',
    talent_id: 'u1',
    agency_id: 'ag1',
    users: [{ full_name: 'Jane Talent' }],
    video_versions: [
      { version_number: 2, created_at: '2026-01-05T00:00:00Z' },
      { version_number: 1, created_at: '2026-01-01T00:00:00Z' },
    ],
  }

  it('extracts talent_name from nested users array', async () => {
    const { getAgencyVideos } = await import('./dashboard')
    const { supabase } = makeQueryStub([sampleVideoRow], [])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await getAgencyVideos({ supabase: supabase as any, agency_ids: ['ag1'] })
    assert.equal(data[0]?.talent_name, 'Jane Talent')
  })

  it('picks the highest version_number as latest_version', async () => {
    const { getAgencyVideos } = await import('./dashboard')
    const { supabase } = makeQueryStub([sampleVideoRow], [])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await getAgencyVideos({ supabase: supabase as any, agency_ids: ['ag1'] })
    assert.equal(data[0]?.latest_version, 2)
  })

  it('returns comment_count 0 when no comments exist', async () => {
    const { getAgencyVideos } = await import('./dashboard')
    const { supabase } = makeQueryStub([sampleVideoRow], [])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await getAgencyVideos({ supabase: supabase as any, agency_ids: ['ag1'] })
    assert.equal(data[0]?.comment_count, 0)
  })
})
