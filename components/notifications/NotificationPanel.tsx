'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { type Notification, notificationHref } from '@/hooks/useNotifications'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function notificationLabel(type: Notification['type']): string {
  switch (type) {
    case 'new_comment':
      return 'New comment'
    case 'comment_resolved':
      return 'Comment resolved'
    case 'status_changed':
      return 'Status changed'
    case 'invitation_accepted':
      return 'Invitation accepted'
    default:
      return 'Notification'
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface NotificationPanelProps {
  notifications: Notification[]
  unreadCount: number
  isLoading: boolean
  onMarkRead: (id: string) => Promise<void>
  onMarkAllRead: () => Promise<void>
  onClose: () => void
}

export function NotificationPanel({
  notifications,
  unreadCount,
  isLoading,
  onMarkRead,
  onMarkAllRead,
  onClose,
}: NotificationPanelProps) {
  const router = useRouter()
  const panelRef = useRef<HTMLDivElement>(null)

  // Focus management: move focus to panel on mount, trap focus within it
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    // Focus the first focusable element (button or link) in the panel
    const focusableElements = panel.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    const firstFocusable = focusableElements[0] as HTMLElement | undefined
    if (firstFocusable) {
      firstFocusable.focus()
    } else {
      // If no focusable element, focus the panel itself
      panel.setAttribute('tabindex', '-1')
      panel.focus()
    }

    // Focus trap: prevent Tab from leaving the panel
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const focusableEls = Array.from(
        panel.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ) as HTMLElement[]

      if (focusableEls.length === 0) return

      const firstEl = focusableEls[0]
      const lastEl = focusableEls[focusableEls.length - 1]
      const isShiftTab = e.shiftKey

      if (isShiftTab) {
        // Shift+Tab on first element: focus last
        if (document.activeElement === firstEl) {
          e.preventDefault()
          lastEl.focus()
        }
      } else {
        // Tab on last element: focus first
        if (document.activeElement === lastEl) {
          e.preventDefault()
          firstEl.focus()
        }
      }
    }

    panel.addEventListener('keydown', handleKeyDown)
    return () => {
      panel.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const handleNotificationClick = async (n: Notification) => {
    if (!n.read_at) {
      await onMarkRead(n.id)
    }
    onClose()
    router.push(notificationHref(n))
  }

  const handleMarkAllRead = async () => {
    await onMarkAllRead()
  }

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-gray-200 bg-white shadow-lg"
      role="dialog"
      aria-label="Notifications"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Notifications</h2>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="text-xs text-blue-600 hover:text-blue-700 focus:outline-none"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Body */}
      <ul className="max-h-80 overflow-y-auto" role="list">
        {isLoading ? (
          <li className="px-4 py-8 text-center text-sm text-gray-500">Loading…</li>
        ) : notifications.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-gray-500">No notifications yet</li>
        ) : (
          notifications.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => void handleNotificationClick(n)}
                className={`w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 focus:outline-none ${
                  !n.read_at ? 'bg-blue-50' : ''
                }`}
                aria-label={`${notificationLabel(n.type)}${!n.read_at ? ' (unread)' : ''}`}
              >
                <div className="flex items-start gap-2">
                  {!n.read_at && (
                    <span
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500"
                      aria-hidden="true"
                    />
                  )}
                  <div className={!n.read_at ? '' : 'ml-4'}>
                    <p className="text-sm font-medium text-gray-900">{notificationLabel(n.type)}</p>
                    {n.payload && typeof n.payload === 'object' && 'message' in n.payload && (
                      <p className="mt-0.5 text-xs text-gray-600 line-clamp-2">
                        {String(n.payload.message)}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-gray-400">
                      {formatRelativeTime(n.created_at)}
                    </p>
                  </div>
                </div>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
