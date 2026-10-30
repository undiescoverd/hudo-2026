/**
 * Unit tests for lib/storage-purge.ts and StorageClient.deletePrefix.
 * No real network: Supabase, R2 and Sentry are stubbed.
 * Run: pnpm exec tsx --test lib/storage-purge.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { S3Client } from '@aws-sdk/client-s3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createStorageClient, type StorageClient } from './storage'
import { drainStorageDeletions, runStoragePurge } from './storage-purge'

// ---------------------------------------------------------------------------
// Supabase stub: an in-memory storage_deletions table behind the chain used.
// ---------------------------------------------------------------------------

interface Row {
  id: number
  target: string
  is_prefix: boolean
  attempts: number
  enqueued_at: string
  completed_at: string | null
  last_error: string | null
}

function makeRow(partial: Partial<Row> & { id: number; target: string }): Row {
  return {
    is_prefix: false,
    attempts: 0,
    enqueued_at: `2026-01-01T00:00:${String(partial.id).padStart(2, '0')}Z`,
    completed_at: null,
    last_error: null,
    ...partial,
  }
}

function makeAdmin(rows: Row[]): SupabaseClient {
  const from = (table: string) => {
    assert.equal(table, 'storage_deletions')
    return {
      select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
        const preds: Array<(r: Row) => boolean> = []
        let max = Infinity
        const q = {
          is: (col: 'completed_at', v: null) => {
            preds.push((r) => r[col] === v)
            return q
          },
          lt: (col: 'attempts', v: number) => {
            preds.push((r) => r[col] < v)
            return q
          },
          gte: (col: 'attempts', v: number) => {
            preds.push((r) => r[col] >= v)
            return q
          },
          order: () => q,
          limit: (n: number) => {
            max = n
            return q
          },
          then: (resolve: (v: unknown) => void) => {
            const matched = rows.filter((r) => preds.every((p) => p(r)))
            if (opts?.head) return resolve({ count: matched.length, data: null, error: null })
            return resolve({
              data: [...matched]
                .sort((a, b) => a.enqueued_at.localeCompare(b.enqueued_at))
                .slice(0, max)
                .map((r) => ({ ...r })),
              error: null,
            })
          },
        }
        return q
      },
      update: (patch: Partial<Row>) => ({
        eq: async (_col: 'id', id: number) => {
          const row = rows.find((r) => r.id === id)
          if (row) Object.assign(row, patch)
          return { error: null }
        },
      }),
    }
  }
  return { from } as unknown as SupabaseClient
}

function makeStorage(overrides: Partial<StorageClient> = {}) {
  const calls = { deletePrefix: [] as string[], deleteObject: [] as string[] }
  const storage = {
    deletePrefix: async (p: string) => {
      calls.deletePrefix.push(p)
      return 1
    },
    deleteObject: async (k: string) => {
      calls.deleteObject.push(k)
    },
    ...overrides,
  } as unknown as StorageClient
  return { storage, calls }
}

function makeSentry() {
  const messages: string[] = []
  return { messages, sentry: { captureMessage: (m: string) => void messages.push(m) } }
}

const A = 'c0ffee24-0000-4000-a000-000000000001'
const V = 'c0ffee24-0000-4000-a000-0000000000a1'

// ---------------------------------------------------------------------------
// drainStorageDeletions
// ---------------------------------------------------------------------------

describe('drainStorageDeletions', () => {
  it('prefix row calls deletePrefix and is marked complete', async () => {
    const rows = [makeRow({ id: 1, target: `${A}/${V}/`, is_prefix: true })]
    const { storage, calls } = makeStorage()
    const res = await drainStorageDeletions({ admin: makeAdmin(rows), storage })
    assert.deepEqual(calls.deletePrefix, [`${A}/${V}/`])
    assert.equal(calls.deleteObject.length, 0)
    assert.ok(rows[0].completed_at)
    assert.deepEqual(res, { processed: 1, failed: 0, skipped: 0 })
  })

  it('key row calls deleteObject and is marked complete', async () => {
    const rows = [makeRow({ id: 1, target: `${A}/${V}/v1.mp4` })]
    const { storage, calls } = makeStorage()
    const res = await drainStorageDeletions({ admin: makeAdmin(rows), storage })
    assert.deepEqual(calls.deleteObject, [`${A}/${V}/v1.mp4`])
    assert.ok(rows[0].completed_at)
    assert.equal(res.processed, 1)
  })

  it('already-deleted counts as done (NoSuchKey)', async () => {
    const rows = [makeRow({ id: 1, target: 'gone.mp4' })]
    const { storage } = makeStorage({
      deleteObject: async () => {
        throw Object.assign(new Error('nope'), { name: 'NoSuchKey' })
      },
    })
    const res = await drainStorageDeletions({ admin: makeAdmin(rows), storage })
    assert.ok(rows[0].completed_at)
    assert.equal(rows[0].attempts, 0)
    assert.deepEqual(res, { processed: 1, failed: 0, skipped: 0 })
  })

  it('other errors increment attempts, set last_error and count as failed', async () => {
    const rows = [makeRow({ id: 1, target: 'k.mp4' })]
    const { storage } = makeStorage({
      deleteObject: async () => {
        throw new Error('R2 exploded')
      },
    })
    const { sentry, messages } = makeSentry()
    const res = await drainStorageDeletions({ admin: makeAdmin(rows), storage, sentry })
    assert.equal(rows[0].completed_at, null)
    assert.equal(rows[0].attempts, 1)
    assert.equal(rows[0].last_error, 'R2 exploded')
    assert.deepEqual(res, { processed: 0, failed: 1, skipped: 0 })
    assert.equal(messages.length, 0, 'no Sentry noise before the final attempt')
  })

  it('rows at maxAttempts are not selected, and give-up is reported to Sentry once', async () => {
    const rows = [
      makeRow({ id: 1, target: 'parked.mp4', attempts: 5 }),
      makeRow({ id: 2, target: 'last-try.mp4', attempts: 4 }),
    ]
    const { storage, calls } = makeStorage({
      deleteObject: async () => {
        throw new Error('still broken')
      },
    })
    const { sentry, messages } = makeSentry()
    const admin = makeAdmin(rows)
    const first = await drainStorageDeletions({ admin, storage, sentry, maxAttempts: 5 })
    assert.equal(calls.deleteObject.length, 0, 'parked row untouched')
    assert.equal(rows[1].attempts, 5)
    assert.deepEqual(first, { processed: 0, failed: 1, skipped: 2 })
    assert.equal(messages.length, 1)

    // A second run neither retries nor re-reports either row.
    const second = await drainStorageDeletions({ admin, storage, sentry, maxAttempts: 5 })
    assert.deepEqual(second, { processed: 0, failed: 0, skipped: 2 })
    assert.equal(messages.length, 1)
  })

  it('honours batchSize', async () => {
    const rows = [1, 2, 3].map((id) => makeRow({ id, target: `k${id}.mp4` }))
    const { storage } = makeStorage()
    const res = await drainStorageDeletions({ admin: makeAdmin(rows), storage, batchSize: 2 })
    assert.equal(res.processed, 2)
    assert.equal(rows[2].completed_at, null)
  })

  it('runStoragePurge wraps the drainer result', async () => {
    const { storage } = makeStorage()
    const res = await runStoragePurge({ admin: makeAdmin([]), storage })
    assert.deepEqual(res, { drained: { processed: 0, failed: 0, skipped: 0 } })
  })
})

// ---------------------------------------------------------------------------
// StorageClient.deletePrefix (real implementation, mock S3Client)
// ---------------------------------------------------------------------------

describe('StorageClient.deletePrefix', () => {
  function mockS3(pages: Array<{ keys: string[]; truncated?: boolean }>, deleteErrors?: unknown[]) {
    const calls: Array<{ name: string; input: Record<string, unknown> }> = []
    let page = 0
    const client = {
      send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
        calls.push({ name: cmd.constructor.name, input: cmd.input })
        if (cmd.constructor.name === 'ListObjectsV2Command') {
          const p = pages[page++] ?? { keys: [] }
          return {
            Contents: p.keys.map((Key) => ({ Key })),
            IsTruncated: !!p.truncated,
            NextContinuationToken: p.truncated ? `tok${page}` : undefined,
          }
        }
        return { Errors: deleteErrors }
      },
    } as unknown as S3Client
    return { client, calls }
  }

  it('rejects a prefix without a trailing slash', async () => {
    const m = mockS3([])
    const s = createStorageClient({ client: m.client, bucket: 'b' })
    await assert.rejects(() => s.deletePrefix(`${A}/${V}`), /must end with '\/'/)
    assert.equal(m.calls.length, 0)
  })

  it('returns 0 and issues no delete for an empty prefix', async () => {
    const m = mockS3([{ keys: [] }])
    const s = createStorageClient({ client: m.client, bucket: 'b' })
    assert.equal(await s.deletePrefix(`${A}/`), 0)
    assert.deepEqual(
      m.calls.map((c) => c.name),
      ['ListObjectsV2Command']
    )
  })

  it('paginates and deletes with Quiet DeleteObjects, returning the count', async () => {
    const m = mockS3([
      { keys: ['p/a', 'p/b'], truncated: true },
      { keys: ['p/c'], truncated: false },
    ])
    const s = createStorageClient({ client: m.client, bucket: 'b' })
    assert.equal(await s.deletePrefix('p/'), 3)
    assert.deepEqual(
      m.calls.map((c) => c.name),
      [
        'ListObjectsV2Command',
        'DeleteObjectsCommand',
        'ListObjectsV2Command',
        'DeleteObjectsCommand',
      ]
    )
    assert.equal(m.calls[2].input.ContinuationToken, 'tok1')
    const del = m.calls[1].input.Delete as { Quiet: boolean; Objects: unknown[] }
    assert.equal(del.Quiet, true)
    assert.equal(del.Objects.length, 2)
  })

  it('throws when R2 reports per-key errors', async () => {
    const m = mockS3([{ keys: ['p/a'] }], [{ Code: 'AccessDenied', Message: 'no' }])
    const s = createStorageClient({ client: m.client, bucket: 'b' })
    await assert.rejects(() => s.deletePrefix('p/'), /AccessDenied/)
  })
})
