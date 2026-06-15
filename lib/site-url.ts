import type { NextRequest } from 'next/server'

/**
 * Returns a trusted base URL for outbound links generated in server-side code
 * (email links, invite URLs, auth redirects).
 *
 * Priority:
 *  1. NEXT_PUBLIC_SITE_URL  — explicitly configured; always wins (production / staging)
 *  2. VERCEL_URL            — injected by the Vercel platform at deploy time, safe for
 *                             preview deployments (not derived from request headers)
 *  3. request.url origin    — local dev fallback only; localhost is not a public endpoint
 *                             so host-header spoofing is not a concern here
 *
 * Never pass `request` in a deployed environment that lacks both env vars — the caller
 * should configure NEXT_PUBLIC_SITE_URL or rely on VERCEL_URL instead.
 */
export function getSiteOrigin(request?: NextRequest): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  if (request) return new URL(request.url).origin
  return 'http://localhost:3000'
}
