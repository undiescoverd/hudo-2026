'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import {
  buildInvitePayload,
  getInvitableRoles,
  submitInvite,
  type InviteRole,
} from '@/lib/invite-permissions'

export interface InviteFormProps {
  agencyId: string
  /** Caller's membership role in this agency; bounds the selectable roles. */
  inviterRole: string
}

export function InviteForm({ agencyId, inviterRole }: InviteFormProps) {
  const router = useRouter()
  const roles = getInvitableRoles(inviterRole)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InviteRole | ''>(roles[0] ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!role || submitting) return
    setError(null)
    setSuccess(null)
    setSubmitting(true)
    const result = await submitInvite(buildInvitePayload(email, role, agencyId))
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSuccess(`Invitation sent to ${email.trim()}`)
    setEmail('')
    setRole(roles[0] ?? '')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <label htmlFor="invite-email" className="block text-sm font-medium mb-1">
          Email
        </label>
        <Input
          id="invite-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
        />
      </div>
      <div>
        <label htmlFor="invite-role" className="block text-sm font-medium mb-1">
          Role
        </label>
        <select
          id="invite-role"
          value={role}
          onChange={(e) => setRole(e.target.value as InviteRole)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {r.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={submitting || !role}
        className="h-10 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50"
      >
        {submitting ? 'Sending…' : 'Send invitation'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-destructive sm:basis-full">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm text-muted-foreground sm:basis-full">
          {success}
        </p>
      )}
    </form>
  )
}
