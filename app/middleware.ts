import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Public paths that do not require authentication.
 * TODO: PR-REVIEW: Add password reset and email confirmation paths here when
 * S0-AUTH-007 (password reset flow) is implemented.
 */
const PUBLIC_PATHS = ['/sign-in', '/sign-up', '/auth/register']

// Validate at module load time so a missing env var surfaces immediately
// rather than silently on the first request. Next.js Edge Runtime loads the
// middleware module once per worker, so this acts as a startup check.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing required Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY'
  )
}

/**
 * Next.js middleware for route protection.
 *
 * - Refreshes the Supabase session cookie on every request so auth state
 *   persists across page reloads without requiring a client-side hydration step.
 * - Redirects unauthenticated users to /sign-in for protected routes.
 * - Passes through requests to public paths and static assets.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // Cookie handling pattern from @supabase/ssr docs: mutating request.cookies
  // alongside response.cookies is required so both server components and the
  // response cookie header stay in sync within the same request lifecycle.
  const supabase = createServerClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({
          request,
        })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // Refresh session — required for Server Components to pick up the session.
  // On Supabase failure, fail closed: protected routes redirect to sign-in
  // (user does not receive the protected content — this IS fail-closed behaviour).
  // TODO: PR-REVIEW: Rate limiting on auth endpoints is handled in S0-AUTH-004
  // via Upstash Redis; not implemented here to avoid Edge Runtime Redis dependency.
  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))

  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
    // TODO: PR-REVIEW: Membership validation (ensuring authenticated user belongs to
    // an agency) belongs in S0-AUTH-006 (role-based middleware) after S0-DB-002 (RLS
    // policies) is complete. This middleware only checks authentication, not authorisation.
  } catch (err) {
    console.error('[middleware] supabase.auth.getUser() failed', err)
    if (isPublic) return response
    const signInUrl = request.nextUrl.clone()
    signInUrl.pathname = '/sign-in'
    return NextResponse.redirect(signInUrl)
  }

  // Allow public paths through without auth check.
  if (isPublic) {
    return response
  }

  // Redirect unauthenticated users to the sign-in page, preserving the intended destination.
  if (!user) {
    const signInUrl = request.nextUrl.clone()
    signInUrl.pathname = '/sign-in'
    signInUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(signInUrl)
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico
     * - api routes (handled individually)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/).*)',
  ],
}
