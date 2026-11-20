import { timingSafeEqual } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { runStoragePurge, type DrainDeps } from '@/lib/storage-purge'

/** Vercel cron function timeout. */
export const maxDuration = 60

/**
 * GET /api/cron/storage-purge
 * Vercel cron — daily at 01:00 UTC (before the 02:00 storage-reconcile) (Hobby plan: max once/day).
 * Requires Authorization: Bearer <CRON_SECRET>.
 *
 * Drains the storage_deletions queue (R2 objects/prefixes queued by the
 * purge_* functions). Core logic lives in lib/storage-purge.ts (Next.js
 * forbids non-reserved route exports).
 */
export async function GET(request: NextRequest, deps?: DrainDeps) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[cron/storage-purge] CRON_SECRET not configured')
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
    const result = await runStoragePurge(deps)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/storage-purge] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
