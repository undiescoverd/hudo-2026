import { type NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { checkAuthRateLimit, getClientIp, AUTH_RATE_WINDOW } from '@/lib/rate-limit'
import { rateLimitFailClosedResponse } from '@/lib/api-helpers'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * POST /api/auth/signin
 *
 * Authenticates with Supabase Auth via email/password.
 * Rate limited per IP and email (5 attempts / 15 min).
 * Session cookies set automatically by Supabase SSR client.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { email, password } = body as Record<string, unknown>

  if (typeof email !== 'string' || !email.trim() || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }

  if (typeof password !== 'string' || !password) {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 })
  }

  // Rate limit — fail-closed on Redis error: credential-guessing surface, so a Redis
  // outage must not hand out unlimited sign-in attempts (see lib/api-helpers.ts).
  try {
    const { limited } = await checkAuthRateLimit(ip, email.trim(), 'signin')
    if (limited) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(AUTH_RATE_WINDOW) } }
      )
    }
  } catch (err) {
    return rateLimitFailClosedResponse('signin', err)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[signin] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)

  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })

  if (error) {
    console.error('[signin] auth.signInWithPassword failed:', error.message)
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  return NextResponse.json({ success: true })
}
