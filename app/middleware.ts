import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Public paths that do not require authentication.
 */
const PUBLIC_PATHS = [
  '/sign-in',
  '/sign-up',
  '/auth/register',
  '/auth/invite',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/guest',
]

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

/** Roles that can access /admin routes. */
const ADMIN_ROLES = new Set(['owner', 'admin_agent'])

/** Roles that can access /agent routes. */
const AGENT_ROLES = new Set(['owner', 'admin_agent', 'agent'])

/** Roles that can access /talent routes. */
const TALENT_ROLES = new Set(['owner', 'admin_agent', 'agent', 'talent'])

/**
 * Returns the set of roles required for a given pathname, or null if no
 * role restriction applies (authenticated users of any role may access it).
 */
function requiredRolesFor(pathname: string): Set<string> | null {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return ADMIN_ROLES
  if (pathname === '/agent' || pathname.startsWith('/agent/')) return AGENT_ROLES
  if (pathname === '/talent' || pathname.startsWith('/talent/')) return TALENT_ROLES
  return null
}

/**
 * Next.js middleware for route protection.
 *
 * - Refreshes the Supabase session cookie on every request so auth state
 *   persists across page reloads without requiring a client-side hydration step.
 * - Redirects unauthenticated users to /sign-in for protected routes.
 * - Passes through requests to public paths and static assets.
 * - Enforces role-based access on /admin, /agent, and /talent routes by
 *   querying the memberships table. Returns 403 for insufficient role.
 * - /guest/* paths are public — guests are authenticated via signed tokens
 *   in API routes, not via Supabase Auth.
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

  // Guest paths (/guest/*) are entirely public — bypass auth middleware.
  // Guest access is validated via signed tokens in the API routes.
  if (isPublic) {
    return response
  }

  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[middleware] supabase.auth.getUser() failed:', message)
    const signInUrl = request.nextUrl.clone()
    signInUrl.pathname = '/sign-in'
    return NextResponse.redirect(signInUrl)
  }

  // Redirect unauthenticated users to the sign-in page, preserving the intended destination.
  if (!user) {
    const signInUrl = request.nextUrl.clone()
    signInUrl.pathname = '/sign-in'
    signInUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(signInUrl)
  }

  // Role-based access check for role-restricted routes.
  const required = requiredRolesFor(pathname)
  if (required !== null) {
    // Fetch the user's roles across all their agency memberships.
    // We only need to know if they hold at least one role from the required set —
    // we do not enforce a specific agency context at the middleware layer.
    let userRoles: string[] = []
    try {
      const { data, error } = await supabase
        .from('memberships')
        .select('role')
        .eq('user_id', user.id)

      if (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[middleware] memberships query failed:', message)
        // Fail closed: treat as unauthorised
        return new NextResponse('Forbidden', { status: 403 })
      }

      userRoles = (data ?? []).map((m: { role: string }) => m.role)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error('[middleware] memberships query threw:', message)
      return new NextResponse('Forbidden', { status: 403 })
    }

    const hasRequiredRole = userRoles.some((role) => required.has(role))
    if (!hasRequiredRole) {
      return new NextResponse('Forbidden', { status: 403 })
    }
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
