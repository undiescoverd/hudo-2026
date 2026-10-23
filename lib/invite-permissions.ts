/**
 * Invitation role permissions — shared by POST /api/invitations/send (enforcement)
 * and the settings/team UI (bounded role choices). Lives outside route.ts because a
 * Next.js route module may only export HTTP handlers/route config.
 */

export const VALID_INVITE_ROLES = ['admin_agent', 'agent', 'talent'] as const
export type InviteRole = (typeof VALID_INVITE_ROLES)[number]

/**
 * Roles that each membership role is allowed to invite.
 */
export const INVITE_PERMISSIONS: Record<string, InviteRole[]> = {
  owner: ['admin_agent', 'agent', 'talent'],
  admin_agent: ['admin_agent', 'agent', 'talent'],
  agent: ['talent'],
}

/** Roles the given membership role may invite (empty for talent/unknown). */
export function getInvitableRoles(role: string): InviteRole[] {
  return INVITE_PERMISSIONS[role] ?? []
}

export function canInvite(role: string): boolean {
  return getInvitableRoles(role).length > 0
}

export type InviteRequestBody = { email: string; role: InviteRole; agencyId: string }

/** Exact body shape expected by POST /api/invitations/send. */
export function buildInvitePayload(
  email: string,
  role: InviteRole,
  agencyId: string
): InviteRequestBody {
  return { email: email.trim(), role, agencyId }
}

export type PendingInvitation = {
  id: string
  email: string
  role: string
  expires_at: string
  accepted_at?: string | null
}

/** Keep only invitations that are unaccepted and unexpired at `now`. */
export function filterPendingInvitations<T extends PendingInvitation>(
  rows: T[],
  now: Date = new Date()
): T[] {
  return rows.filter((r) => !r.accepted_at && new Date(r.expires_at).getTime() > now.getTime())
}

export type InviteResult = { ok: true } | { ok: false; error: string }

/** POST the invite and normalise the outcome (route error message, incl. 429/402/403). */
export async function submitInvite(
  body: InviteRequestBody,
  fetchImpl: typeof fetch = fetch
): Promise<InviteResult> {
  try {
    const res = await fetchImpl('/api/invitations/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) return { ok: true }
    let message = ''
    try {
      const data = (await res.json()) as { error?: unknown }
      if (typeof data.error === 'string') message = data.error
    } catch {
      /* non-JSON body */
    }
    if (!message) {
      message =
        res.status === 429
          ? 'Too many invitations. Please try again later.'
          : 'Failed to send invitation'
    }
    return { ok: false, error: message }
  } catch {
    return { ok: false, error: 'Network error — please try again.' }
  }
}
