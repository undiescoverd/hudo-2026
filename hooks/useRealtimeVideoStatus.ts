// hooks/useRealtimeVideoStatus.ts
'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/auth'

interface UseRealtimeVideoStatusOptions {
  agencyId: string
  onChange: () => void
}

/**
 * Subscribes to live `videos` row changes scoped to a single agency, so
 * dashboards/lists/detail pages can pick up server-side status flips (e.g.
 * a talent self-upload auto-flipping to `pending_review`) without a manual
 * refresh. postgres_changes respects RLS per subscriber, so agents receive
 * agency-wide video events while talent only receive events for their own
 * videos even though the channel filter is agency-scoped.
 */
export function useRealtimeVideoStatus({
  agencyId,
  onChange,
}: UseRealtimeVideoStatusOptions): void {
  useEffect(() => {
    if (!agencyId) return

    const supabase = createClient()
    const channelName = `videos:${agencyId}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'videos',
          filter: `agency_id=eq.${agencyId}`,
        },
        () => {
          onChange()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [agencyId, onChange])
}
