'use client'

import React, { useState, useTransition } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface NotificationPreferencesProps {
  initialEmailEnabled: boolean
  initialBatchWindowMinutes: 5 | 15 | 30 | 60
}

const BATCH_WINDOW_OPTIONS = [
  { value: '5', label: '5 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '60 minutes' },
] as const

export function NotificationPreferences({
  initialEmailEnabled,
  initialBatchWindowMinutes,
}: NotificationPreferencesProps) {
  const [emailEnabled, setEmailEnabled] = useState(initialEmailEnabled)
  const [batchWindowMinutes, setBatchWindowMinutes] = useState(initialBatchWindowMinutes)
  const [isPending, startTransition] = useTransition()
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function save(updates: { email_enabled?: boolean; batch_window_minutes?: number }) {
    setErrorMessage(null)
    setSavedMessage(null)

    const res = await fetch('/api/notifications/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setErrorMessage(body.error ?? 'Failed to save preferences')
      return
    }

    setSavedMessage('Preferences saved.')
  }

  function handleEmailEnabledChange(checked: boolean | 'indeterminate') {
    const next = checked === true
    setEmailEnabled(next)
    startTransition(() => {
      void save({ email_enabled: next })
    })
  }

  function handleBatchWindowChange(value: string) {
    const next = Number(value) as 5 | 15 | 30 | 60
    setBatchWindowMinutes(next)
    startTransition(() => {
      void save({ batch_window_minutes: next })
    })
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-lg font-medium">Notification preferences</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Control how and when you receive email notifications.
        </p>
      </div>

      <div className="space-y-4">
        {/* email_enabled toggle */}
        <div className="flex items-start gap-3">
          <Checkbox
            id="email_enabled"
            checked={emailEnabled}
            onCheckedChange={handleEmailEnabledChange}
            disabled={isPending}
            aria-label="Enable email notifications"
          />
          <div>
            <label htmlFor="email_enabled" className="text-sm font-medium cursor-pointer">
              Email notifications
            </label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Receive email digests when new comments are added to your videos.
            </p>
          </div>
        </div>

        {/* batch_window_minutes select */}
        <div className="space-y-1.5">
          <label htmlFor="batch_window_minutes" className="text-sm font-medium">
            Notification frequency
          </label>
          <p className="text-xs text-muted-foreground">
            How long to wait before sending a batched email digest.
          </p>
          <Select
            value={String(batchWindowMinutes)}
            onValueChange={handleBatchWindowChange}
            disabled={isPending || !emailEnabled}
          >
            <SelectTrigger id="batch_window_minutes" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BATCH_WINDOW_OPTIONS.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {savedMessage && (
        <p role="status" className="text-sm text-green-600">
          {savedMessage}
        </p>
      )}
      {errorMessage && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
