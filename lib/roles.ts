/**
 * Role lists shared by API routes and client components.
 *
 * Kept dependency-free (no `next/server`, no Supabase) so `'use client'`
 * pages can gate UI on the exact same list the API enforces — e.g. the video
 * page hides GuestShareButton unless `isAgentPlusRole(role)`, matching
 * `requireAgentRole` on /api/videos/:id/guest-links.
 */
export const AGENT_PLUS_ROLES = ['owner', 'admin_agent', 'agent'] as const

export function isAgentPlusRole(role: string | null | undefined): boolean {
  return typeof role === 'string' && (AGENT_PLUS_ROLES as readonly string[]).includes(role)
}
