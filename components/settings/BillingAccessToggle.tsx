'use client'

import React, { useState } from 'react'

export type BillingAccessResult = { ok: true; enabled: boolean } | { ok: false; error: string }

/** PATCH the per-person billing-access flag. Exported for tests (injectable fetch). */
export async function submitBillingAccess(
  agencyId: string,
  userId: string,
  enabled: boolean,
  fetchFn: typeof fetch = fetch
): Promise<BillingAccessResult> {
  try {
    const res = await fetchFn(`/api/agencies/${agencyId}/members/${userId}/billing-access`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, error: body.error ?? 'Could not update billing access.' }
    }
    return { ok: true, enabled }
  } catch {
    return { ok: false, error: 'Network error — please try again.' }
  }
}

type Props = {
  agencyId: string
  userId: string
  /** Display name or email of the admin agent. */
  name: string
  initialEnabled: boolean
}

export type BillingAccessRow = { userId: string; name: string; enabled: boolean }

/** One toggle per admin agent. The caller passes admin agents only (see settings/team page). */
export function BillingAccessList({
  agencyId,
  admins,
}: {
  agencyId: string
  admins: BillingAccessRow[]
}) {
  if (admins.length === 0) {
    return <p className="text-sm text-muted-foreground">No admin agents to give access to.</p>
  }
  return (
    <ul className="divide-y rounded-md border">
      {admins.map((a) => (
        <li key={a.userId} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
          <span className="font-medium">{a.name}</span>
          <BillingAccessToggle
            agencyId={agencyId}
            userId={a.userId}
            name={a.name}
            initialEnabled={a.enabled}
          />
        </li>
      ))}
    </ul>
  )
}

/** Owner-only switch: gives one admin agent access to billing (plan view, invoices, payment method). */
export function BillingAccessToggle({ agencyId, userId, name, initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onChange(next: boolean) {
    setPending(true)
    setError(null)
    const result = await submitBillingAccess(agencyId, userId, next)
    if (result.ok) setEnabled(result.enabled)
    else setError(result.error)
    setPending(false)
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(e) => void onChange(e.target.checked)}
          aria-label={`Billing access for ${name}`}
        />
        <span>{enabled ? 'Can manage billing' : 'No billing access'}</span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
