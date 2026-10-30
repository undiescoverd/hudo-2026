import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { createStorageClient, type StorageClient } from '@/lib/storage'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * Drains the `storage_deletions` queue (migration 0024) filled by the purge
 * functions (0025). This is the ONLY place R2 objects are deleted: all deletes
 * go through purge_* + this queue. Lives in lib/ (not route.ts) because Next.js
 * route modules may only export reserved fields.
 */

export const DEFAULT_BATCH_SIZE = 200
export const DEFAULT_MAX_ATTEMPTS = 5

export interface DrainDeps {
  admin?: SupabaseClient
  storage?: StorageClient
  batchSize?: number
  maxAttempts?: number
  sentry?: {
    captureMessage: (msg: string, context?: Record<string, unknown>) => void
  }
}

export interface DrainResult {
  processed: number
  failed: number
  /** Rows parked at maxAttempts (not retried). */
  skipped: number
}

interface QueueRow {
  id: number
  target: string
  is_prefix: boolean
  attempts: number
}

/** R2/S3 "already gone" errors count as success so the queue never spins on them. */
function isAlreadyGone(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }
  return (
    e.name === 'NoSuchKey' ||
    e.name === 'NotFound' ||
    e.Code === 'NoSuchKey' ||
    e.$metadata?.httpStatusCode === 404
  )
}

function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.slice(0, 500)
}

export async function drainStorageDeletions(deps?: DrainDeps): Promise<DrainResult> {
  const admin = deps?.admin ?? createAdminClient()
  const storage = deps?.storage ?? createStorageClient()
  const batchSize = deps?.batchSize ?? DEFAULT_BATCH_SIZE
  const maxAttempts = deps?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const sentry = deps?.sentry ?? {
    captureMessage: (msg: string, context?: Record<string, unknown>) =>
      Sentry.captureMessage(msg, { extra: context }),
  }

  const { data, error } = await admin
    .from('storage_deletions')
    .select('id, target, is_prefix, attempts')
    .is('completed_at', null)
    .lt('attempts', maxAttempts)
    .order('enqueued_at', { ascending: true })
    .limit(batchSize)

  if (error) {
    throw new Error(`[storage-purge] Failed to read queue: ${error.message}`)
  }

  const rows = (data as QueueRow[] | null) ?? []
  let processed = 0
  let failed = 0

  for (const row of rows) {
    try {
      if (row.is_prefix) {
        await storage.deletePrefix(row.target)
      } else {
        try {
          await storage.deleteObject(row.target)
        } catch (err) {
          if (!isAlreadyGone(err)) throw err
        }
      }
      const { error: updErr } = await admin
        .from('storage_deletions')
        .update({ completed_at: new Date().toISOString(), last_error: null })
        .eq('id', row.id)
      if (updErr) {
        // The R2 delete is idempotent, so a retry next run is safe.
        throw new Error(`failed to mark complete: ${updErr.message}`)
      }
      processed++
    } catch (err) {
      failed++
      const attempts = row.attempts + 1
      await admin
        .from('storage_deletions')
        .update({ attempts, last_error: errorMessage(err) })
        .eq('id', row.id)
      if (attempts >= maxAttempts) {
        // Reported exactly once: the row is never selected again after this.
        sentry.captureMessage(`[storage-purge] Giving up on queue row ${row.id}`, {
          id: row.id,
          target: row.target,
          attempts,
          lastError: errorMessage(err),
        })
      }
    }
  }

  const { count } = await admin
    .from('storage_deletions')
    .select('id', { count: 'exact', head: true })
    .is('completed_at', null)
    .gte('attempts', maxAttempts)

  return { processed, failed, skipped: count ?? 0 }
}

/**
 * Entry point for the daily cron. Later phases add purgeEmptyDrafts and
 * purgeExpiredArchive here; the route only ever calls this.
 */
export async function runStoragePurge(deps?: DrainDeps): Promise<{ drained: DrainResult }> {
  return { drained: await drainStorageDeletions(deps) }
}
