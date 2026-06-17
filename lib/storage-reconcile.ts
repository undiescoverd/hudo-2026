import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { createStorageClient, type StorageClient } from '@/lib/storage'

/**
 * Storage reconciliation core (S3-SEC-004).
 *
 * Lives in lib/ rather than the route module because Next.js route files may
 * only export the framework's reserved fields (GET, maxDuration, …) — a
 * `reconcileStorage` export from route.ts fails `next build` with
 * "not a valid Route export field". Keeping the logic here also makes it
 * directly unit-testable without going through the HTTP handler.
 */

/** Minimum drift (bytes) that triggers a Sentry alert: > 1 MiB. */
export const DRIFT_THRESHOLD_BYTES = 1_048_576

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

/**
 * Read-only reconciliation: for every agency, sum the bytes of R2 objects
 * under its `${agencyId}/` prefix and compare to agencies.storage_usage_bytes.
 * Drift > 1 MiB is reported to Sentry. Never writes back to the database.
 */
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
