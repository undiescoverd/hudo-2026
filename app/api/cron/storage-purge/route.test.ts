/**
 * Unit tests for app/api/cron/storage-purge/route.ts
 * Run: pnpm exec tsx --test app/api/cron/storage-purge/route.test.ts
 */

import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { StorageClient } from '@/lib/storage'
import { GET } from './route'

const SECRET = 'test-cron-secret-xyz'

function makeRequest(secret?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (secret !== undefined) headers['authorization'] = `Bearer ${secret}`
  return new NextRequest('http://localhost/api/cron/storage-purge', { headers })
}

/** Admin stub with one pending key row; records the completion update. */
function makeDeps() {
  const updates: Array<Record<string, unknown>> = []
  const queue = [{ id: 1, target: 'a/b/v1.mp4', is_prefix: false, attempts: 0 }]
  const admin = {
    from: () => ({
      select: (_c: string, opts?: { head?: boolean }) => {
        const q = {
          is: () => q,
          lt: () => q,
          gte: () => q,
          order: () => q,
          limit: () => q,
          then: (resolve: (v: unknown) => void) =>
            resolve(
              opts?.head ? { count: 0, data: null, error: null } : { data: queue, error: null }
            ),
        }
        return q
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          updates.push(patch)
          return { error: null }
        },
      }),
    }),
  } as unknown as SupabaseClient
  const storage = {
    deleteObject: async () => {},
    deletePrefix: async () => 0,
  } as unknown as StorageClient
  return { deps: { admin, storage }, updates }
}

describe('GET /api/cron/storage-purge', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeRequest(SECRET))
    assert.equal(res.status, 500)
  })

  it('returns 401 for a missing, wrong or wrong-length bearer', async () => {
    assert.equal((await GET(makeRequest(undefined))).status, 401)
    assert.equal((await GET(makeRequest('wrong-secret'))).status, 401)
    assert.equal((await GET(makeRequest('x'))).status, 401)
  })

  it('returns 200 with the drainer result for the right bearer', async () => {
    const { deps, updates } = makeDeps()
    const res = await GET(makeRequest(SECRET), deps)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { drained: { processed: 1, failed: 0, skipped: 0 } })
    assert.equal(updates.length, 2, 'claim + completion writes')
  })

  it('returns 500 when the queue cannot be read', async () => {
    const admin = {
      from: () => ({
        select: () => {
          const q = {
            is: () => q,
            lt: () => q,
            order: () => q,
            limit: () => q,
            then: (resolve: (v: unknown) => void) =>
              resolve({ data: null, error: { message: 'boom' } }),
          }
          return q
        },
      }),
    } as unknown as SupabaseClient
    const res = await GET(makeRequest(SECRET), { admin, storage: {} as StorageClient })
    assert.equal(res.status, 500)
  })
})
