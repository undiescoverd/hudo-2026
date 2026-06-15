import { type NextRequest, NextResponse } from 'next/server'
import { batchAndSendNotifications } from '@/lib/notifications'

/**
 * GET /api/cron/notifications
 * Vercel cron — runs every 5 minutes (see vercel.json).
 * Requires Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[cron/notifications] CRON_SECRET not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
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
