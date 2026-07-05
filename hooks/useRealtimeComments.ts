// hooks/useRealtimeComments.ts
'use client'

import { useEffect } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { rowToComment, type Comment } from '@/lib/comments'
import { createClient } from '@/lib/auth'

interface UseRealtimeCommentsOptions {
  videoVersionId: string
  onInsert: (comment: Comment) => void
  onUpdate: (comment: Comment) => void
  onDelete: (commentId: string) => void
}

export function useRealtimeComments({
  videoVersionId,
  onInsert,
  onUpdate,
  onDelete,
}: UseRealtimeCommentsOptions): void {
  useEffect(() => {
    if (!videoVersionId) return

    const supabase = createClient()
    const channelName = `video-version:${videoVersionId}`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleChange = (payload: RealtimePostgresChangesPayload<Record<string, any>>) => {
      if (payload.eventType === 'INSERT') {
        onInsert(rowToComment(payload.new))
      } else if (payload.eventType === 'UPDATE') {
        onUpdate(rowToComment(payload.new))
      } else if (payload.eventType === 'DELETE') {
        const id = (payload.old as { id?: string }).id
        if (id) onDelete(id)
      }
    }

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'comments',
          filter: `video_version_id=eq.${videoVersionId}`,
        },
        handleChange
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [videoVersionId, onInsert, onUpdate, onDelete])
}
