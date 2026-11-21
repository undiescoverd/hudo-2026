import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { safeRedirect } from '@/lib/auth-validation'
import { checkRateLimit } from '@/lib/api-helpers'
import { AUTH_RATE_WINDOW, getClientIp } from '@/lib/rate-limit'

/**
 * GET /auth/callback
 *
 * Supabase PKCE email flow (confirmation, recovery) redirects here with ?code=.
 * This route exchanges the code for a session and forwards the user to `next`
 * (defaulting to /) so they land authenticated.
 * Rate limited at 10 requests per IP per 15 minutes.
 */
export async function GET(request: NextRequest) {
  // Rate limit by IP: 10 requests per 15 minutes. Fail-closed on Redis error, like the
  // other unauthenticated auth routes (see lib/api-helpers.ts): 503, not a silent allow.
  // A plain 429, not a redirect to sign-in: Retry-After on a 3xx means "wait before
  // following the redirect", and the sign-in page doesn't render an `?error=` param.
  const rl = await checkRateLimit(
    `auth:callback:ip:${getClientIp(request)}`,
    10,
    AUTH_RATE_WINDOW,
    'auth/callback',
    'Too many requests. Please wait a few minutes, then open the link again or request a new one.',
    'fail-closed'
  )
  if (rl) return rl

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  // Guard against open redirect: only same-origin local paths (see safeRedirect); else '/'.
  const next = safeRedirect(url.searchParams.get('next'), '/')

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin))
    }
  }

  return NextResponse.redirect(new URL('/auth/signin?error=auth', url.origin))
}
