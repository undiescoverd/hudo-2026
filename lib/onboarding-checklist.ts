/**
 * lib/onboarding-checklist.ts
 * Owner onboarding checklist for /dashboard, derived purely from existing data
 * (memberships, invitations) — no table, no migration.
 *
 * Derivation rules:
 *  - Invite an agent: the agency has another member, or an invitation, with role
 *    agent | admin_agent. A *pending* (unexpired) invite counts: the owner has done
 *    their part, and acceptance is outside their control. Expired-unaccepted ones don't.
 *  - Invite a talent: same, for role talent.
 *
 * Fail-closed: any query error hides the checklist (returns null) and logs, so an
 * error never reads as "all done" nor shows misleading unchecked items.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type ChecklistItem = {
  key: 'invite-agent' | 'invite-talent'
  label: string
  description: string
  href: string
  done: boolean
}

export type OnboardingChecklist = {
  agencyId?: string
  /** Set only when the user owns more than one agency. */
  agencyName?: string | null
  items: ChecklistItem[]
  allDone: boolean
}

export type DeriveInput = {
  /** Other members of the agency (the owner's own membership excluded). */
  members: Array<{ role: string }>
  invitations: Array<{ role: string; accepted_at: string | null; expires_at: string }>
  now?: Date
}

const AGENT_ROLES = new Set(['agent', 'admin_agent'])
const TALENT_ROLES = new Set(['talent'])

export function deriveChecklist({
  members,
  invitations,
  now = new Date(),
}: DeriveInput): OnboardingChecklist {
  // An unaccepted invite that has expired no longer counts: the owner must re-invite (intended).
  const live = invitations.filter(
    (i) => i.accepted_at !== null || new Date(i.expires_at).getTime() > now.getTime()
  )
  const has = (roles: Set<string>) =>
    members.some((m) => roles.has(m.role)) || live.some((i) => roles.has(i.role))

  const items: ChecklistItem[] = [
    {
      key: 'invite-agent',
      label: 'Invite an agent',
      description: 'Bring a teammate in to review and manage videos.',
      href: '/settings/team',
      done: has(AGENT_ROLES),
    },
    {
      key: 'invite-talent',
      label: 'Invite a talent',
      description: 'Add the talent whose videos you will review.',
      href: '/settings/team',
      done: has(TALENT_ROLES),
    },
  ]
  return { items, allDone: items.every((i) => i.done) }
}

/**
 * Returns the checklist to show, or null when it must be hidden
 * (not an owner, every owned agency complete, or any query failed). Uses the
 * RLS-scoped client. Owned agencies are checked oldest-membership first and the
 * first incomplete one is shown. Queries: 1 owner lookup, then 1 each for
 * agencies/memberships/invitations (batched with .in).
 */
export async function getOnboardingChecklist({
  supabase,
  userId,
}: {
  supabase: SupabaseClient
  userId: string
}): Promise<OnboardingChecklist | null> {
  // Explicit owner equality — never roleAtLeast (fails open on unknown roles).
  const { data: owned, error: ownedError } = await supabase
    .from('memberships')
    .select('agency_id')
    .eq('user_id', userId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })

  if (ownedError) {
    console.error('[onboarding-checklist] owner lookup failed:', ownedError.message)
    return null
  }
  const ids = ((owned ?? []) as Array<{ agency_id: string }>).map((r) => r.agency_id)
  if (ids.length === 0) return null

  const [agencies, members, invitations] = await Promise.all([
    supabase.from('agencies').select('id, name').in('id', ids),
    supabase.from('memberships').select('agency_id, user_id, role').in('agency_id', ids),
    supabase
      .from('invitations')
      .select('agency_id, role, accepted_at, expires_at')
      .in('agency_id', ids),
  ])

  const failed = [agencies.error, members.error, invitations.error].find(Boolean)
  if (failed) {
    console.error('[onboarding-checklist] query failed:', failed.message)
    return null
  }

  const names = new Map(
    ((agencies.data ?? []) as Array<{ id: string; name: string }>).map((a) => [a.id, a.name])
  )
  const memberRows = (members.data ?? []) as Array<{
    agency_id: string
    user_id: string
    role: string
  }>
  const inviteRows = (invitations.data ?? []) as Array<
    DeriveInput['invitations'][number] & { agency_id: string }
  >

  for (const agencyId of ids) {
    const result = deriveChecklist({
      members: memberRows.filter((m) => m.agency_id === agencyId && m.user_id !== userId),
      invitations: inviteRows.filter((i) => i.agency_id === agencyId),
    })
    if (!result.allDone) {
      return {
        ...result,
        agencyId,
        agencyName: ids.length > 1 ? (names.get(agencyId) ?? null) : null,
      }
    }
  }
  return null
}
