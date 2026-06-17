import { timingSafeEqual } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { createStorageClient, type StorageClient } from '@/lib/storage'

/** Vercel cron function timeout; reconciliation is sequential + unbounded per agency. */
export const maxDuration = 60

/** Minimum drift (bytes) that triggers a Sentry alert: > 1 MiB. */
const DRIFT_THRESHOLD_BYTES = 1_048_576

interface Agency {
  id: string
  storage_usage_bytes: number
}

/** Injected dependencies — used in tests to avoid real R2 / Supabase calls. */
export interface ReconcileDeps {
  storage?: StorageClient
  supabase?: SupabaseClient
  sentry?: {
    captureMessage: (msg: string, context?: Record<string, unknown>) => void
  }
}

function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[cron/storage-reconcile] Missing Supabase env vars')
  return createClient(url, key)
}

export async function reconcileStorage(deps?: ReconcileDeps): Promise<{
  checked: number
  drifted: number
  agencies: Array<{ id: string; actual: number; stored: number; drift: number }>
}> {
  const storage = deps?.storage ?? createStorageClient()
  const supabase = deps?.supabase ?? createAdminClient()
  const sentry = deps?.sentry ?? {
    captureMessage: (msg: string, context?: Record<string, unknown>) =>
      Sentry.captureMessage(msg, { extra: context }),
  }

  const { data: agencies, error } = await supabase
    .from('agencies')
    .select('id, storage_usage_bytes')

  if (error) {
    throw new Error(`[cron/storage-reconcile] Failed to fetch agencies: ${error.message}`)
  }

  const agencyList = (agencies as Agency[]) ?? []
  const results: Array<{ id: string; actual: number; stored: number; drift: number }> = []

  // Process agencies in batches of 5 for bounded concurrency
  const batchSize = 5
  for (let i = 0; i < agencyList.length; i += batchSize) {
    const batch = agencyList.slice(i, i + batchSize)

    const batchPromises = batch.map(async (agency) => {
      const actual = await storage.sumSizesUnderPrefix(`${agency.id}/`)
      const stored = agency.storage_usage_bytes ?? 0
      const drift = Math.abs(actual - stored)

      return { id: agency.id, actual, stored, drift }
    })

    const batchResults = await Promise.allSettled(batchPromises)

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        const { id, actual, stored, drift } = result.value
        results.push({ id, actual, stored, drift })

        if (drift > DRIFT_THRESHOLD_BYTES) {
          sentry.captureMessage(`[storage-reconcile] Drift detected for agency ${id}`, {
            agencyId: id,
            actualBytes: actual,
            storedBytes: stored,
            driftBytes: drift,
          })
        }
      } else {
        console.error(`[storage-reconcile] Error processing agency:`, result.reason)
      }
    }
  }

  return {
    checked: results.length,
    drifted: results.filter((r) => r.drift > DRIFT_THRESHOLD_BYTES).length,
    agencies: results,
  }
}

/**
 * GET /api/cron/storage-reconcile
 * Vercel cron — nightly at 02:00 UTC (Hobby plan: max once/day).
 * Requires Authorization: Bearer <CRON_SECRET>.
 *
 * Read-only reconciliation: lists R2 objects under each agency's prefix,
 * compares to agencies.storage_usage_bytes, and reports drift > 1 MiB to
 * Sentry. Never writes back to the database.
 */
export async function GET(request: NextRequest, deps?: ReconcileDeps) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[cron/storage-reconcile] CRON_SECRET not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const incomingHeader = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${cronSecret}`
  const safe =
    incomingHeader.length === expected.length &&
    timingSafeEqual(Buffer.from(incomingHeader), Buffer.from(expected))
  if (!safe) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await reconcileStorage(deps)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/storage-reconcile] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
