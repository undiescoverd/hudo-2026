import { createClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { getClientIp } from '@/lib/rate-limit'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * POST /api/auth/reset-password
 *
 * Sends a password reset email via Supabase Auth (which uses Resend as the email provider).
 * Rate limited at 5 requests per IP per hour.
 * Always returns a generic success message — no email enumeration.
 */
export async function POST(request: NextRequest) {
  // Rate limit by IP: 5 requests per hour.
  // Dynamic import + try/catch = fail-open: if Redis is unavailable, the request proceeds.
  const ip = getClientIp(request)
  try {
    const { rateLimit } = await import('@/lib/redis')
    const remaining = await rateLimit(`auth:reset-password:ip:${ip}`, 5, 3600)

    if (remaining === -1) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again in an hour.' },
        {
          status: 429,
          headers: { 'Retry-After': '3600' },
        }
      )
    }
  } catch (err) {
    // Fail-open: log error (captured by Sentry in production) and allow request
    console.error('[reset-password] Rate limit check failed, allowing request:', err)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { email } = body as Record<string, unknown>

  if (typeof email !== 'string' || !email.trim() || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !anonKey) {
    console.error('[reset-password] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const supabase = createClient(supabaseUrl, anonKey)

  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${siteUrl}/auth/reset-password`,
  })

  if (error) {
    console.error('[reset-password] auth.resetPasswordForEmail failed:', error.message)
    // Return generic success to prevent email enumeration
  }

  // Always return success — never reveal whether the email exists
  return NextResponse.json({ success: true })
}
