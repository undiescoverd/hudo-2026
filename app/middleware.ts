import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Public paths that do not require authentication.
 */
const PUBLIC_PATHS = ['/sign-in', '/sign-up']

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

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    }
  )

  // Refresh session — required for Server Components to pick up the session.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Allow public paths through without auth check.
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return response
  }

  // Redirect unauthenticated users to the sign-in page.
  if (!user) {
    const signInUrl = request.nextUrl.clone()
    signInUrl.pathname = '/sign-in'
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
