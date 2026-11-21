/**
 * lib/onboarding-checklist.ts
 * Owner onboarding checklist for /dashboard, derived purely from existing data
 * (memberships, invitations, video_versions) — no table, no migration.
 *
 * Derivation rules:
 *  - Invite an agent: the agency has another member, or an invitation, with role
 *    agent | admin_agent. A *pending* (unexpired) invite counts: the owner has done
 *    their part, and acceptance is outside their control. Expired-unaccepted ones don't.
 *  - Invite a talent: same, for role talent.
 *  - Upload a video: the agency has at least one video_versions row.
 *
 * Fail-closed: any query error hides the checklist (returns null) and logs, so an
 * error never reads as "all done" nor shows misleading unchecked items.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type ChecklistItem = {
  key: 'invite-agent' | 'invite-talent' | 'upload-video'
  label: string
  description: string
  href: string
  done: boolean
}

export type OnboardingChecklist = {
  agencyId?: string
  items: ChecklistItem[]
  allDone: boolean
}

export type DeriveInput = {
  /** Other members of the agency (the owner's own membership excluded). */
  members: Array<{ role: string }>
  invitations: Array<{ role: string; accepted_at: string | null; expires_at: string }>
  hasVideoVersion: boolean
  now?: Date
}

const AGENT_ROLES = new Set(['agent', 'admin_agent'])
const TALENT_ROLES = new Set(['talent'])

export function deriveChecklist({
  members,
  invitations,
  hasVideoVersion,
  now = new Date(),
}: DeriveInput): OnboardingChecklist {
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
    {
      key: 'upload-video',
      label: 'Upload a video',
      description: 'Upload your first video for review.',
      href: '/upload',
      done: hasVideoVersion,
    },
  ]
  return { items, allDone: items.every((i) => i.done) }
}

/**
 * Returns the checklist to show, or null when it must be hidden
 * (not an owner, all done, or any query failed). Uses the RLS-scoped client.
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
    .limit(1)

  if (ownedError) {
    console.error('[onboarding-checklist] owner lookup failed:', ownedError.message)
    return null
  }
  const agencyId = (owned as Array<{ agency_id: string }> | null)?.[0]?.agency_id
  if (!agencyId) return null

  const [members, invitations, versions] = await Promise.all([
    supabase.from('memberships').select('user_id, role').eq('agency_id', agencyId),
    supabase.from('invitations').select('role, accepted_at, expires_at').eq('agency_id', agencyId),
    supabase.from('video_versions').select('id').eq('agency_id', agencyId).limit(1),
  ])

  const failed = [members.error, invitations.error, versions.error].find(Boolean)
  if (failed) {
    console.error('[onboarding-checklist] query failed:', failed.message)
    return null
  }

  const result = deriveChecklist({
    members: ((members.data ?? []) as Array<{ user_id: string; role: string }>).filter(
      (m) => m.user_id !== userId
    ),
    invitations: (invitations.data ?? []) as DeriveInput['invitations'],
    hasVideoVersion: (versions.data ?? []).length > 0,
  })
  return result.allDone ? null : { ...result, agencyId }
}
