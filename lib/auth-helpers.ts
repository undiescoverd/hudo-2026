/**
 * lib/auth-helpers.ts
 * Shared server-side auth utilities.
 * Extracts and reuses the role-resolution logic that was inline in layout.tsx.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserRole } from '@/lib/auth'

// Re-export for callers that only want the type
export type { UserRole }

/** Role hierarchy ordered highest-privilege first. */
const HIERARCHY: UserRole[] = ['owner', 'admin_agent', 'agent', 'talent']

export type CurrentUserRole = {
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null
  role: UserRole
  agency_ids: string[]
}

/**
 * Resolve the current authenticated user's highest-privilege role and
 * all agency IDs they belong to.
 *
 * Returns:
 *  - `user`       — the Supabase auth user (or null if unauthenticated)
 *  - `role`       — highest-privilege role across all memberships (defaults to 'talent')
 *  - `agency_ids` — every agency_id the user is a member of
 */
export async function getCurrentUserRole(supabase: SupabaseClient): Promise<CurrentUserRole> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, role: 'talent', agency_ids: [] }
  }

  const { data: memberships } = await supabase
    .from('memberships')
    .select('role, agency_id')
    .eq('user_id', user.id)

  const rows = (memberships ?? []) as Array<{ role: string; agency_id: string }>
  const agency_ids = rows.map((m) => m.agency_id)

  const roles = rows.map((m) => m.role as UserRole)

  let role: UserRole = 'talent'
  if (roles.length > 0) {
    roles.sort((a, b) => HIERARCHY.indexOf(a) - HIERARCHY.indexOf(b))
    role = roles[0]
  }

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase user type is broad
    user: user as any,
    role,
    agency_ids,
  }
}
