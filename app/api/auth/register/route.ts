import { createClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { validatePassword } from '@/lib/auth-validation'

/**
 * POST /api/auth/register
 *
 * Creates a new Supabase Auth user and inserts a corresponding public.users record.
 * Supabase automatically sends a confirmation email on signUp — the email provider
 * (Resend) is configured via S0-INFRA-012; local dev uses the built-in mailpit service.
 */
export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { email, password, fullName } = body as Record<string, unknown>

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (typeof email !== 'string' || !email.trim() || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }
  if (typeof fullName !== 'string' || !fullName.trim()) {
    return NextResponse.json({ error: 'Full name is required' }, { status: 400 })
  }
  if (typeof password !== 'string') {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 })
  }

  const passwordError = validatePassword(password)
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('[register] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  // Sign up via anon key — Supabase sends confirmation email automatically.
  const supabase = createClient(supabaseUrl, anonKey)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      // After email confirmation, redirect to app root (future: /onboarding — S4-LAUNCH-004)
      emailRedirectTo: `${siteUrl}/`,
    },
  })

  if (error) {
    console.error('[register] auth.signUp failed:', error.message)
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 400 })
  }

  // Insert into public.users via service role (bypasses RLS — this route is server-side only).
  if (data.user) {
    const admin = createClient(supabaseUrl, serviceRoleKey)
    const { error: insertError } = await admin.from('users').insert({
      id: data.user.id,
      email: email.trim().toLowerCase(),
      full_name: fullName.trim(),
    })
    if (insertError) {
      // Log but don't surface — the auth user exists and email confirmation will proceed.
      // A reconciliation step can create the users record on first sign-in if needed.
      console.error('[register] users insert failed:', insertError.message)
    }
  }

  return NextResponse.json({ success: true })
}
