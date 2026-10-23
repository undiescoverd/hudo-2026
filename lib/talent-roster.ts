import type { SupabaseClient } from '@supabase/supabase-js'

export interface TalentRosterEntry {
  id: string
  fullName: string
  email: string
}

interface RosterRow {
  users: { id: string; full_name: string; email: string } | null
}

/**
 * The agency's talent roster: users with a `talent` membership in `agencyId`.
 *
 * `memberships.user_id -> users(id)` is the only FK between the tables, so the
 * hint `memberships_user_id_fkey` is unambiguous. RLS `users_select_agency`
 * lets agency members read co-members. Errors are thrown, never swallowed into
 * an empty list (an empty roster means "no talent", a different thing).
 *
 * No role guard here: RLS lets any agency member (including talent) read
 * co-members' name and email, so callers MUST gate on `isAgentClassRole`.
 */
export async function fetchTalentRoster(
  supabase: SupabaseClient,
  agencyId: string
): Promise<TalentRosterEntry[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select('users!memberships_user_id_fkey(id, full_name, email)')
    .eq('agency_id', agencyId)
    .eq('role', 'talent')

  if (error) throw new Error(`Failed to load talent roster: ${error.message}`)

  return ((data ?? []) as unknown as RosterRow[])
    .flatMap((row) => (row.users ? [row.users] : []))
    .map((u) => ({ id: u.id, fullName: u.full_name, email: u.email }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
}

/** Roles that upload on behalf of a talent and must choose one. */
export function isAgentClassRole(role: string): boolean {
  return role === 'agent' || role === 'admin_agent' || role === 'owner'
}
