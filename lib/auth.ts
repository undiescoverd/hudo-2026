import { createBrowserClient } from '@supabase/ssr'
import type { Session, User } from '@supabase/supabase-js'

/**
 * Creates a Supabase browser client for use in Client Components.
 * Uses @supabase/ssr to handle session persistence via cookies,
 * ensuring auth state persists across page reloads.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * Returns the current session, or null if unauthenticated.
 * Must be called in a Client Component or after createClient().
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
