import { createBrowserClient } from '@supabase/ssr'
import type { Session, User } from '@supabase/supabase-js'

/**
 * Role hierarchy for Hudo.
 * Ordered highest-privilege first.
 */
export type UserRole = 'owner' | 'admin_agent' | 'agent' | 'talent'

/** Ordered role hierarchy — index 0 is the highest-privilege role. */
const ROLE_HIERARCHY: UserRole[] = ['owner', 'admin_agent', 'agent', 'talent']

/**
 * Returns true if `role` meets the minimum required privilege level.
 *
 * Example: `roleAtLeast('agent', 'admin_agent')` → false
 *          `roleAtLeast('owner', 'admin_agent')` → true
 */
export function roleAtLeast(role: UserRole, minimum: UserRole): boolean {
  return ROLE_HIERARCHY.indexOf(role) <= ROLE_HIERARCHY.indexOf(minimum)
}

/**
 * Creates a Supabase browser client for use in Client Components.
 * Uses @supabase/ssr to handle session persistence via cookies,
 * ensuring auth state persists across page reloads.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Missing required Supabase environment variables')
  }
  return createBrowserClient(url, key)
}

/**
 * Returns the current session, or null if unauthenticated.
 * Must be called in a Client Component or after createClient().
 *
 * A new client is created per call intentionally — createBrowserClient is
 * lightweight and stateless; memoisation would introduce shared mutable state.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session
}

/**
 * Returns the currently authenticated user, or null if unauthenticated.
 */
export async function getUser(): Promise<User | null> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

/**
 * Returns the user's role for a specific agency, or null if the user is not
 * a member of that agency.
 *
 * Uses the browser client — suitable for Client Components.
 * Server-side role checks in middleware use the server client directly.
 */
export async function getUserRole(userId: string, agencyId: string): Promise<UserRole | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('memberships')
    .select('role')
    .eq('user_id', userId)
    .eq('agency_id', agencyId)
    .maybeSingle()

  if (error || !data) return null
  return data.role as UserRole
}

/**
 * Returns all roles the user holds across any agency.
 * Useful when agency context is not yet established.
 */
export async function getUserRoles(userId: string): Promise<UserRole[]> {
  const supabase = createClient()
  const { data, error } = await supabase.from('memberships').select('role').eq('user_id', userId)

  if (error || !data) return []
  return data.map((m: { role: string }) => m.role as UserRole)
}

/**
 * Signs in with email and password.
 * Returns the session on success, or an error.
 */
export async function signInWithPassword(email: string, password: string) {
  const supabase = createClient()
  return supabase.auth.signInWithPassword({ email, password })
}

/**
 * Signs out the current user and clears the session cookie.
 */
export async function signOut() {
  const supabase = createClient()
  return supabase.auth.signOut()
}
