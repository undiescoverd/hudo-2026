import React from 'react'
import type { PendingInvitation } from '@/lib/invite-permissions'

export function PendingInvitations({ invitations }: { invitations: PendingInvitation[] }) {
  if (invitations.length === 0) {
    return <p className="text-sm text-muted-foreground">No pending invitations.</p>
  }
  return (
    <ul className="divide-y rounded-md border">
      {invitations.map((inv) => (
        <li key={inv.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
          <span className="font-medium">{inv.email}</span>
          <span className="text-muted-foreground">
            {inv.role.replaceAll('_', ' ')} · expires{' '}
            {new Date(inv.expires_at).toISOString().slice(0, 10)}
          </span>
        </li>
      ))}
    </ul>
  )
}
