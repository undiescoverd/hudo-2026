'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/auth'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Notification {
  id: string
  recipient_id: string
  video_id: string | null
  comment_id: string | null
  agency_id: string
  payload: Record<string, unknown> | null
  read_at: string | null
  sent_at: string | null
  created_at: string
  type: 'new_comment' | 'comment_resolved' | 'status_changed' | 'invitation_accepted'
}

export interface UseNotificationsResult {
  notifications: Notification[]
  unreadCount: number
  isLoading: boolean
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Returns the href to navigate to when a notification is clicked.
 * video_id present → /videos/<video_id>
 * Otherwise → /dashboard (safe fallback for status_changed / invitation_accepted)
 */
export function notificationHref(n: Pick<Notification, 'video_id'>): string {
  if (n.video_id) return `/videos/${n.video_id}`
  return '/dashboard'
}

/**
 * Caps a list to at most 50 items (newest-first ordering preserved).
 */
export function capAt50<T>(items: T[]): T[] {
  return items.slice(0, 50)
}

/**
 * Counts unread items in a notification list.
 */
export function countUnread(notifications: Notification[]): number {
  return notifications.filter((n) => n.read_at === null).length
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useNotifications(): UseNotificationsResult {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  // Resolved user id drives the Realtime subscription reactively
  const [userId, setUserId] = useState<string | null>(null)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const data = (await res.json()) as {
        notifications: Notification[]
        unread_count: number
      }
      setNotifications(capAt50(data.notifications))
      setUnreadCount(data.unread_count)
    } catch (err) {
      console.error('[useNotifications] fetch failed:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial fetch + resolve user id for Realtime subscription filter
  useEffect(() => {
    let cancelled = false

    async function init() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (cancelled) return
      setUserId(user?.id ?? null)

      await fetchNotifications()
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [fetchNotifications])

  // Realtime subscription — reactive to resolved userId, scoped per-user via recipient_id filter
  useEffect(() => {
    if (!userId) return

    const supabase = createClient()
    const channelName = `notifications:${userId}`
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${userId}`,
        },
        () => {
          // On any change, refetch from the server to stay authoritative
          void fetchNotifications()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, fetchNotifications])

  const markRead = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/notifications/${id}`, { method: 'PATCH' })
      if (!res.ok) {
        console.error('[useNotifications] markRead failed:', res.status)
        return
      }
      // Optimistic local update
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))
    } catch (err) {
      console.error('[useNotifications] markRead error:', err)
    }
  }, [])

  const markAllRead = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { method: 'PATCH' })
      if (!res.ok) {
        console.error('[useNotifications] markAllRead failed:', res.status)
        return
      }
      // Optimistic local update
      const now = new Date().toISOString()
      setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })))
      setUnreadCount(0)
    } catch (err) {
      console.error('[useNotifications] markAllRead error:', err)
    }
  }, [])

  return { notifications, unreadCount, isLoading, markRead, markAllRead }
}
