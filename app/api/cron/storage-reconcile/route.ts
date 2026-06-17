import { timingSafeEqual } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { reconcileStorage, type ReconcileDeps } from '@/lib/storage-reconcile'

/** Vercel cron function timeout; reconciliation is sequential + unbounded per agency. */
export const maxDuration = 60

/**
 * GET /api/cron/storage-reconcile
 * Vercel cron — nightly at 02:00 UTC (Hobby plan: max once/day).
 * Requires Authorization: Bearer <CRON_SECRET>.
 *
 * Read-only reconciliation: lists R2 objects under each agency's prefix,
 * compares to agencies.storage_usage_bytes, and reports drift > 1 MiB to
 * Sentry. Never writes back to the database. Core logic lives in
 * lib/storage-reconcile.ts (Next.js forbids non-reserved route exports).
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
