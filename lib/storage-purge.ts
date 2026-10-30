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

export const DEFAULT_DEADLINE_MS = 45_000

export interface DrainDeps {
  admin?: SupabaseClient
  storage?: StorageClient
  batchSize?: number
  maxAttempts?: number
  /** Stop starting new rows this long after the drain began (route maxDuration is 60s). */
  deadlineMs?: number
  /** Injectable clock for tests. */
  now?: () => number
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

/**
 * R2/S3 "already gone" errors count as success so the queue never spins on them.
 * Deliberately NOT a blanket 404 check: NoSuchBucket is also a 404 and means misconfiguration.
 */
function isAlreadyGone(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  return name === 'NoSuchKey' || name === 'NotFound'
}

export async function drainStorageDeletions(deps?: DrainDeps): Promise<DrainResult> {
  const admin = deps?.admin ?? createAdminClient()
  const storage = deps?.storage ?? createStorageClient()
  const batchSize = deps?.batchSize ?? DEFAULT_BATCH_SIZE
  const maxAttempts = deps?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const deadlineMs = deps?.deadlineMs ?? DEFAULT_DEADLINE_MS
  const now = deps?.now ?? Date.now
  const sentry = deps?.sentry ?? {
    captureMessage: (msg: string, context?: Record<string, unknown>) =>
      Sentry.captureMessage(msg, { extra: context }),
  }
  const started = now()

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
    if (now() - started >= deadlineMs) break // leave the rest for tomorrow's run

    // Claim first: a run killed mid-R2-call still counts the attempt, so a prefix that
    // always outlives maxDuration reaches maxAttempts instead of looping forever.
    const attempts = row.attempts + 1
    const { error: claimErr } = await admin
      .from('storage_deletions')
      .update({ attempts })
      .eq('id', row.id)
    if (claimErr) {
      console.error(`[storage-purge] Could not claim row ${row.id}: ${claimErr.message}`)
      failed++
      continue
    }

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
    } catch (err) {
      failed++
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500)
      const { error: updErr } = await admin
        .from('storage_deletions')
        .update({ last_error: message })
        .eq('id', row.id)
      if (updErr) {
        console.error(
          `[storage-purge] Could not record failure for row ${row.id}: ${updErr.message}`
        )
        sentry.captureMessage(`[storage-purge] Could not record failure for row ${row.id}`, {
          id: row.id,
          error: updErr.message,
        })
      }
      if (attempts >= maxAttempts) {
        // Reported exactly once: the row is never selected again after this.
        sentry.captureMessage(`[storage-purge] Giving up on queue row ${row.id}`, {
          id: row.id,
          target: row.target,
          attempts,
          lastError: message,
        })
      }
      continue
    }

    const { error: doneErr } = await admin
      .from('storage_deletions')
      .update({ completed_at: new Date(now()).toISOString(), last_error: null })
      .eq('id', row.id)
    if (doneErr) {
      // The R2 delete is idempotent, so the retry next run is safe.
      console.error(`[storage-purge] Could not mark row ${row.id} complete: ${doneErr.message}`)
      failed++
    } else {
      processed++
    }
  }

  const { count, error: countErr } = await admin
    .from('storage_deletions')
    .select('id', { count: 'exact', head: true })
    .is('completed_at', null)
    .gte('attempts', maxAttempts)
  if (countErr) {
    throw new Error(`[storage-purge] Failed to count parked rows: ${countErr.message}`)
  }

  const skipped = count ?? 0
  if (skipped > 0) {
    // Parked erasure rows mean personal data is still in R2: alert every run until handled.
    sentry.captureMessage(`[storage-purge] ${skipped} queue row(s) parked at max attempts`, {
      parked: skipped,
    })
  }

  return { processed, failed, skipped }
}

/**
 * Entry point for the daily cron. Later phases add purgeEmptyDrafts and
 * purgeExpiredArchive here; the route only ever calls this.
 */
export async function runStoragePurge(deps?: DrainDeps): Promise<{ drained: DrainResult }> {
  return { drained: await drainStorageDeletions(deps) }
}
