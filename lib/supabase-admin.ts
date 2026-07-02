import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * createAdminClient — single source of truth for the service-role Supabase
 * client used across API routes, cron jobs, and server-only lib helpers.
 *
 * - Bypasses RLS — only ever use for explicit, validated server-side reads/writes.
 * - `persistSession: false` / `autoRefreshToken: false`: this client never represents
 *   an end-user session, so it must not touch cookies/localStorage or spin up a
 *   background refresh timer (both are meaningless — and wasteful — for a
 *   short-lived, request-scoped service-role client).
 * - Call this INSIDE request handlers / functions, not at module scope — env vars
 *   may be absent at build time (Next.js "Collecting page data" imports route
 *   modules), and a module-level throw crashes `next build` (see CLAUDE.md Failure
 *   Log: "new Resend('') crashes Next.js build").
 * - Throws a clear, greppable error on missing env vars rather than relying on a
 *   non-null assertion (`!`), which would silently pass `undefined` to `createClient`.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('[supabase-admin] Missing NEXT_PUBLIC_SUPABASE_URL environment variable')
  }
  if (!key) {
    throw new Error('[supabase-admin] Missing SUPABASE_SERVICE_ROLE_KEY environment variable')
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
