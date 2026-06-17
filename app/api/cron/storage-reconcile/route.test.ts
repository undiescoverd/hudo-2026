/**
 * Unit tests for app/api/cron/storage-reconcile/route.ts
 *
 * All R2, Supabase, and Sentry dependencies are injected — no real network calls.
 * Run: npx tsx --test "app/api/cron/storage-reconcile/route.test.ts"
 */

import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import { NextRequest } from 'next/server'
import { GET, type ReconcileDeps } from './route'
import type { StorageClient } from '@/lib/storage'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal NextRequest with optional Authorization header. */
function makeRequest(secret?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (secret !== undefined) {
    headers['authorization'] = `Bearer ${secret}`
  }
  return new NextRequest('http://localhost/api/cron/storage-reconcile', { headers })
}

/** Build a minimal StorageClient stub whose sumSizesUnderPrefix resolves from a map. */
function makeStorage(sizesByPrefix: Record<string, number>): StorageClient {
  return {
    sumSizesUnderPrefix: async (prefix: string) => sizesByPrefix[prefix] ?? 0,
    // The remaining methods are not called by the reconciliation path.
    putObject: async () => {},
    getObject: async () => null,
    deleteObject: async () => {},
    generateSignedUrl: async () => '',
    generateUploadUrl: async () => '',
    createMultipartUpload: async () => '',
    generatePartUploadUrl: async () => '',
    completeMultipartUpload: async () => {},
    abortMultipartUpload: async () => {},
    headObject: async () => null,
  } as StorageClient
}

interface SupabaseStub {
  client: SupabaseClient
  updateCalls: number
  upsertCalls: number
  insertCalls: number
  deleteCalls: number
}

/** Build a Supabase stub returning a list of agency rows. */
function makeSupabase(agencies: Array<{ id: string; storage_usage_bytes: number }>): SupabaseStub {
  const stub: SupabaseStub = {
    client: null as unknown as SupabaseClient,
    updateCalls: 0,
    upsertCalls: 0,
    insertCalls: 0,
    deleteCalls: 0,
  }

  stub.client = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    from: (_table: string) => ({
      update: () => {
        stub.updateCalls++
        return { eq: () => Promise.resolve({ error: null }) }
      },
      upsert: () => {
        stub.upsertCalls++
        return Promise.resolve({ error: null })
      },
      insert: () => {
        stub.insertCalls++
        return Promise.resolve({ error: null })
      },
      delete: () => {
        stub.deleteCalls++
        return { eq: () => Promise.resolve({ error: null }) }
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      select: (_cols: string) => Promise.resolve({ data: agencies, error: null }),
    }),
  } as unknown as SupabaseClient

  return stub
}

/** Build a Sentry stub that captures call args. */
function makeSentry() {
  const calls: Array<{ msg: string; context?: Record<string, unknown> }> = []
  return {
    sentry: {
      captureMessage: (msg: string, context?: Record<string, unknown>) => {
        calls.push({ msg, context })
      },
    },
    calls,
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_SECRET = 'test-cron-secret-xyz'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/storage-reconcile', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = VALID_SECRET
  })

  // -------------------------------------------------------------------------
  // AC4: CRON_SECRET authentication
  // -------------------------------------------------------------------------

  describe('auth — CRON_SECRET validation (AC4)', () => {
    it('returns 200 with a valid Authorization header', async () => {
      const { sentry } = makeSentry()
      const deps: ReconcileDeps = {
        storage: makeStorage({}),
        supabase: makeSupabase([]).client,
        sentry,
      }
      const req = makeRequest(VALID_SECRET)
      const res = await GET(req, deps)
      assert.equal(res.status, 200)
    })

    it('returns 401 when Authorization header is missing', async () => {
      const req = makeRequest(undefined)
      const res = await GET(req)
      assert.equal(res.status, 401)
    })

    it('returns 401 when Authorization header has wrong secret', async () => {
      const req = makeRequest('wrong-secret')
      const res = await GET(req)
      assert.equal(res.status, 401)
    })

    it('returns 401 when Authorization header is wrong-length (no timingSafeEqual throw)', async () => {
      // Different-length header must not throw — just 401.
      const req = makeRequest('x')
      const res = await GET(req)
      assert.equal(res.status, 401)
    })

    it('returns 500 when CRON_SECRET env var is not set', async () => {
      delete process.env.CRON_SECRET
      const req = makeRequest(VALID_SECRET)
      const res = await GET(req)
      assert.equal(res.status, 500)
      process.env.CRON_SECRET = VALID_SECRET // restore
    })
  })

  // -------------------------------------------------------------------------
  // AC1: per-agency R2 usage calculation via prefix listing
  // -------------------------------------------------------------------------

  describe('R2 usage calculation (AC1)', () => {
    it('calls sumSizesUnderPrefix with <agencyId>/ prefix for each agency (order may vary due to batching)', async () => {
      const prefixesCalled: string[] = []
      const storage: StorageClient = {
        ...makeStorage({}),
        sumSizesUnderPrefix: async (prefix: string) => {
          prefixesCalled.push(prefix)
          return 0
        },
      }
      const { sentry } = makeSentry()
      const deps: ReconcileDeps = {
        storage,
        supabase: makeSupabase([
          { id: 'agency-aaa', storage_usage_bytes: 0 },
          { id: 'agency-bbb', storage_usage_bytes: 0 },
        ]).client,
        sentry,
      }
      const req = makeRequest(VALID_SECRET)
      await GET(req, deps)
      // Sort because batched concurrency may invoke in any order
      assert.deepEqual(prefixesCalled.sort(), ['agency-aaa/', 'agency-bbb/'])
    })

    it('returns checked count matching number of agencies', async () => {
      const { sentry } = makeSentry()
      const deps: ReconcileDeps = {
        storage: makeStorage({ 'ag-1/': 100, 'ag-2/': 200 }),
        supabase: makeSupabase([
          { id: 'ag-1', storage_usage_bytes: 100 },
          { id: 'ag-2', storage_usage_bytes: 200 },
        ]).client,
        sentry,
      }
      const req = makeRequest(VALID_SECRET)
      const res = await GET(req, deps)
      const body = await res.json()
      assert.equal(body.checked, 2)
    })
  })

  // -------------------------------------------------------------------------
  // AC2 + AC3: drift detection and Sentry reporting
  // -------------------------------------------------------------------------

  describe('drift detection and Sentry reporting (AC2 + AC3)', () => {
    it('does NOT call Sentry when drift is exactly 1 MiB (threshold is strictly >)', async () => {
      const { sentry, calls } = makeSentry()
      const EXACTLY_1MIB = 1_048_576
      const deps: ReconcileDeps = {
        storage: makeStorage({ 'agency-x/': EXACTLY_1MIB }),
        supabase: makeSupabase([{ id: 'agency-x', storage_usage_bytes: 0 }]).client,
        sentry,
      }
      const req = makeRequest(VALID_SECRET)
      await GET(req, deps)
      assert.equal(calls.length, 0, 'Should not report drift at exactly the threshold')
    })

    it('calls Sentry when drift is 1 MiB + 1 byte', async () => {
      const { sentry, calls } = makeSentry()
      const deps: ReconcileDeps = {
        storage: makeStorage({ 'agency-x/': 1_048_577 }),
        supabase: makeSupabase([{ id: 'agency-x', storage_usage_bytes: 0 }]).client,
        sentry,
      }
      const req = makeRequest(VALID_SECRET)
      await GET(req, deps)
      assert.equal(calls.length, 1, 'Should report drift above threshold')
    })

    it('includes agencyId, actual, stored, drift in Sentry context', async () => {
      const { sentry, calls } = makeSentry()
      const actual = 2_097_152 // 2 MiB
      const stored = 0
      const deps: ReconcileDeps = {
        storage: makeStorage({ 'agency-abc/': actual }),
        supabase: makeSupabase([{ id: 'agency-abc', storage_usage_bytes: stored }]).client,
        sentry,
      }
      const req = makeRequest(VALID_SECRET)
      await GET(req, deps)

      assert.equal(calls.length, 1)
      const ctx = calls[0].context ?? {}
      assert.equal(ctx.agencyId, 'agency-abc')
      assert.equal(ctx.actualBytes, actual)
      assert.equal(ctx.storedBytes, stored)
      assert.equal(ctx.driftBytes, actual - stored)
    })

    it('detects drift when actual < stored (under-count)', async () => {
      const { sentry, calls } = makeSentry()
      const deps: ReconcileDeps = {
        storage: makeStorage({ 'agency-y/': 0 }),
        supabase: makeSupabase([{ id: 'agency-y', storage_usage_bytes: 2_000_000 }]).client,
        sentry,
      }
      const req = makeRequest(VALID_SECRET)
      await GET(req, deps)
      assert.equal(calls.length, 1, 'Should report drift when actual < stored')
    })

    it('only reports drifting agencies, not those within threshold', async () => {
      const { sentry, calls } = makeSentry()
      const deps: ReconcileDeps = {
        storage: makeStorage({
          'agency-ok/': 500_000, // drift = 0, well within threshold
          'agency-bad/': 5_000_000, // drift = 5_000_000 > 1 MiB
        }),
        supabase: makeSupabase([
          { id: 'agency-ok', storage_usage_bytes: 500_000 },
          { id: 'agency-bad', storage_usage_bytes: 0 },
        ]).client,
        sentry,
      }
      const req = makeRequest(VALID_SECRET)
      const res = await GET(req, deps)
      const body = await res.json()

      assert.equal(calls.length, 1, 'Sentry called once for the drifting agency only')
      assert.equal(body.drifted, 1)
      assert.equal(body.checked, 2)
    })
  })

  // -------------------------------------------------------------------------
  // AC3 security crux: no DB writes ever happen
  // -------------------------------------------------------------------------

  describe('read-only — no DB writes (AC3 security crux)', () => {
    it('never calls update, upsert, insert, or delete on Supabase', async () => {
      const supabaseStub = makeSupabase([
        { id: 'agency-a', storage_usage_bytes: 0 },
        { id: 'agency-b', storage_usage_bytes: 10_000_000 }, // large drift
      ])
      const { sentry } = makeSentry()
      const deps: ReconcileDeps = {
        storage: makeStorage({ 'agency-a/': 0, 'agency-b/': 0 }),
        supabase: supabaseStub.client,
        sentry,
      }
      const req = makeRequest(VALID_SECRET)
      await GET(req, deps)

      assert.equal(supabaseStub.updateCalls, 0, 'update must never be called')
      assert.equal(supabaseStub.upsertCalls, 0, 'upsert must never be called')
      assert.equal(supabaseStub.insertCalls, 0, 'insert must never be called')
      assert.equal(supabaseStub.deleteCalls, 0, 'delete must never be called')
    })
  })

  // -------------------------------------------------------------------------
  // Error resilience: one agency's failure doesn't abort others
  // -------------------------------------------------------------------------

  describe('error resilience (batched concurrency)', () => {
    it('continues reconciling other agencies if one R2 call fails', async () => {
      const storage: StorageClient = {
        ...makeStorage({ 'agency-ok/': 100 }),
        sumSizesUnderPrefix: async (prefix: string) => {
          if (prefix === 'agency-fail/') {
            throw new Error('R2 connection error')
          }
          return 100
        },
      }
      const { sentry } = makeSentry()
      const deps: ReconcileDeps = {
        storage,
        supabase: makeSupabase([
          { id: 'agency-ok', storage_usage_bytes: 100 },
          { id: 'agency-fail', storage_usage_bytes: 0 },
        ]).client,
        sentry,
      }
      const req = makeRequest(VALID_SECRET)
      const res = await GET(req, deps)
      const body = await res.json()

      // Both agencies were processed; one succeeded, one failed
      // The failed one is excluded from results (Promise.allSettled rejection)
      assert.equal(body.checked, 1, 'Only the successful agency should be in checked count')
      assert.equal(body.agencies.length, 1)
      assert.equal(body.agencies[0].id, 'agency-ok')
    })
  })

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  describe('response shape', () => {
    it('returns JSON with checked, drifted, and agencies array', async () => {
      const { sentry } = makeSentry()
      const deps: ReconcileDeps = {
        storage: makeStorage({ 'ag-1/': 1000 }),
        supabase: makeSupabase([{ id: 'ag-1', storage_usage_bytes: 1000 }]).client,
        sentry,
      }
      const req = makeRequest(VALID_SECRET)
      const res = await GET(req, deps)
      const body = await res.json()

      assert.equal(typeof body.checked, 'number')
      assert.equal(typeof body.drifted, 'number')
      assert.ok(Array.isArray(body.agencies))
      assert.equal(body.agencies[0].id, 'ag-1')
      assert.equal(body.agencies[0].actual, 1000)
      assert.equal(body.agencies[0].stored, 1000)
      assert.equal(body.agencies[0].drift, 0)
    })

    it('returns empty results for zero agencies', async () => {
      const { sentry } = makeSentry()
      const deps: ReconcileDeps = {
        storage: makeStorage({}),
        supabase: makeSupabase([]).client,
        sentry,
      }
      const req = makeRequest(VALID_SECRET)
      const res = await GET(req, deps)
      const body = await res.json()

      assert.equal(body.checked, 0)
      assert.equal(body.drifted, 0)
      assert.deepEqual(body.agencies, [])
    })
  })
})
