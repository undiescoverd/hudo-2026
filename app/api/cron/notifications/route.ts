import { timingSafeEqual } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { batchAndSendNotifications } from '@/lib/notifications'

/**
 * GET /api/cron/notifications
 * Vercel cron — currently daily at midnight UTC (Hobby plan: max once/day; upgrade to Pro for every-5-min cadence).
 * Requires Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[cron/notifications] CRON_SECRET not configured')
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
    const result = await batchAndSendNotifications()
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/notifications] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
