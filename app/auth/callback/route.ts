import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * GET /auth/callback
 *
 * Supabase PKCE email flow (confirmation, recovery) redirects here with ?code=.
 * This route exchanges the code for a session and forwards the user to `next`
 * (defaulting to /) so they land authenticated.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  // Guard against open redirect: only allow same-origin relative paths.
  // new URL(absolute, base) ignores the base, so '//evil.com' or 'https://evil.com'
  // would escape if we didn't strip them here.
  const rawNext = url.searchParams.get('next') ?? '/'
  const next =
    rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.startsWith('/\\')
      ? rawNext
      : '/'

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
