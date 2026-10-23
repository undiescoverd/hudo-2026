import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Public paths that do not require authentication.
 */
const PUBLIC_PATHS = [
  '/auth/signin',
  '/auth/register',
  '/auth/invite',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/callback',
  '/guest',
  // Legal and offline pages — the pages themselves land with LAUNCH-001 / PWA-001
  // (until then they 404, which is harmless).
  '/terms',
  '/privacy',
  '/dpa',
  '/offline',
]

// Validate at module load time so a missing env var surfaces on the first
// request with a clear message. Note this fails EVERY matched request
// (including public /guest and /auth pages), not just protected ones.
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

/** True when the pathname is public (exact match or a sub-path of a public entry). */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/**
 * Returns the set of roles required for a given pathname, or null if no
 * role restriction applies (authenticated users of any role may access it).
 */
export function requiredRolesFor(pathname: string): Set<string> | null {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return ADMIN_ROLES
  if (pathname === '/agent' || pathname.startsWith('/agent/')) return AGENT_ROLES
  if (pathname === '/talent' || pathname.startsWith('/talent/')) return TALENT_ROLES
  return null
}

/**
 * True when a signed-in user holding `roles` (across all their agencies) may
 * not open `pathname`. We do not enforce a specific agency context here.
 */
export function isForbidden(pathname: string, roles: string[]): boolean {
  const required = requiredRolesFor(pathname)
  return required !== null && !roles.some((role) => required.has(role))
}

/**
 * Next.js middleware for route protection (static files and /api are excluded
 * by the matcher below; API routes do their own auth).
 *
 * - Public paths pass straight through. /guest/* is public because guests are
 *   authenticated via signed tokens in API routes, not via Supabase Auth.
 * - Otherwise refreshes the Supabase session cookie, so Server Components see
 *   the session without a client-side hydration step.
 * - Redirects unauthenticated users to /auth/signin?redirect=<path>.
 * - Enforces role-based access on /admin, /agent and /talent by querying the
 *   memberships table. Returns 403 for insufficient role.
 * - Fails closed: a getUser failure redirects to sign-in, a memberships failure
 *   returns 403.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

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

  // getUser() may refresh and rotate the session tokens via setAll above. Any
  // response other than `response` must carry those cookies too, or the browser
  // keeps a stale refresh token and the session can be revoked as reused.
  const withSessionCookies = (res: NextResponse) => {
    response.cookies.getAll().forEach((cookie) => res.cookies.set(cookie))
    return res
  }
  const forbidden = () => withSessionCookies(new NextResponse('Forbidden', { status: 403 }))
  const toSignIn = (withRedirect: boolean) => {
    const signInUrl = request.nextUrl.clone()
    signInUrl.pathname = '/auth/signin'
    signInUrl.search = ''
    // Preserve the intended destination, query included (e.g. a ?t= deep link).
    if (withRedirect) signInUrl.searchParams.set('redirect', pathname + search)
    return withSessionCookies(NextResponse.redirect(signInUrl))
  }

  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[middleware] supabase.auth.getUser() failed:', message)
    return toSignIn(false)
  }

  if (!user) {
    return toSignIn(true)
  }

  if (requiredRolesFor(pathname) !== null) {
    try {
      const { data, error } = await supabase
        .from('memberships')
        .select('role')
        .eq('user_id', user.id)

      if (error) {
        console.error('[middleware] memberships query failed:', error.message)
        return forbidden()
      }

      const roles = (data ?? []).map((m: { role: string }) => m.role)
      if (isForbidden(pathname, roles)) {
        return forbidden()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error('[middleware] memberships query threw:', message)
      return forbidden()
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
     * - named root static files (/icons/*, robots.txt, sitemap.xml, /sw.js,
     *   /manifest.webmanifest). Listed by name, not by extension, so a page
     *   path like /talent/x.png can never skip the auth check.
     */
    '/((?!_next/static|_next/image|favicon\\.ico$|api/|icons/|robots\\.txt$|sitemap\\.xml$|sw\\.js$|manifest\\.webmanifest$).*)',
  ],
}
