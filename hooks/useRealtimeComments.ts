// hooks/useRealtimeComments.ts
'use client'

import { useEffect } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import type { Comment } from '@/lib/comments'
import { createClient } from '@/lib/auth'

// Map snake_case DB row to camelCase Comment
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToComment(row: Record<string, any>): Comment {
  return {
    id: row.id as string,
    videoVersionId: row.video_version_id as string,
    agencyId: row.agency_id as string,
    userId: row.user_id as string,
    content: row.content as string,
    commentType: row.comment_type as 'point' | 'range',
    timestampSeconds: row.timestamp_seconds as number,
    endTimestampSeconds: row.end_timestamp_seconds as number | null,
    parentId: row.parent_id as string | null,
    resolved: row.resolved as boolean,
    resolvedAt: row.resolved_at as string | null,
    resolvedBy: row.resolved_by as string | null,
    deletedAt: row.deleted_at as string | null,
    createdAt: row.created_at as string,
  }
}

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
