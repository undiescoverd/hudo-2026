import { createClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { validatePassword } from '@/lib/auth-validation'
import { checkAuthRateLimit, getClientIp, AUTH_RATE_WINDOW } from '@/lib/rate-limit'
import { getSiteOrigin } from '@/lib/site-url'
import { rateLimitFailClosedResponse } from '@/lib/api-helpers'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * POST /api/auth/register
 *
 * Creates a new Supabase Auth user, then (via the service-role-only RPC
 * create_agency_with_owner) the public.users row, the agency and the owner
 * membership in a single transaction.
 * Supabase automatically sends a confirmation email on signUp — the email provider
 * (Resend) is configured via S0-INFRA-012; local dev uses the built-in mailpit service.
 */
const AGENCY_NAME_MAX = 100
const FULL_NAME_MAX = 100
// Tolerance for clock skew between this server and the auth server's created_at.
const CREATED_SKEW_MS = 60_000

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function POST(request: NextRequest) {
  const requestStart = Date.now()
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

  const { email, password, fullName, agencyName } = body as Record<string, unknown>

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (typeof email !== 'string' || !email.trim() || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }
  if (typeof fullName !== 'string' || !fullName.trim()) {
    return NextResponse.json({ error: 'Full name is required' }, { status: 400 })
  }
  if (fullName.trim().length > FULL_NAME_MAX) {
    return NextResponse.json(
      { error: `Full name must be ${FULL_NAME_MAX} characters or fewer` },
      { status: 400 }
    )
  }
  if (typeof agencyName !== 'string' || !agencyName.trim()) {
    return NextResponse.json({ error: 'Agency name is required' }, { status: 400 })
  }
  if (agencyName.trim().length > AGENCY_NAME_MAX) {
    return NextResponse.json(
      { error: `Agency name must be ${AGENCY_NAME_MAX} characters or fewer` },
      { status: 400 }
    )
  }
  const slug = toSlug(agencyName)
  if (!slug) {
    return NextResponse.json(
      { error: 'Agency name must contain letters or numbers' },
      { status: 400 }
    )
  }
  if (typeof password !== 'string') {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 })
  }

  const passwordError = validatePassword(password)
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 })
  }

  // Rate limit after all input validation — don't burn quota on malformed requests.
  // Fail-closed on Redis error: account-creation surface (see lib/api-helpers.ts).
  try {
    const { limited } = await checkAuthRateLimit(ip, email.trim(), 'register')
    if (limited) {
      return NextResponse.json(
        { error: 'Too many registration attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(AUTH_RATE_WINDOW) } }
      )
    }
  } catch (err) {
    return rateLimitFailClosedResponse('register', err)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !anonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[register] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const admin = createAdminClient()
  const AGENCY_TAKEN = {
    error: 'An agency with that name already exists. Please choose a different name.',
  }

  // Read-only availability check BEFORE signUp so a taken name never creates an auth user.
  const { data: taken, error: slugError } = await admin
    .from('agencies')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()
  if (slugError) {
    console.error('[register] slug check failed:', slugError.message)
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 })
  }
  if (taken) {
    return NextResponse.json(AGENCY_TAKEN, { status: 409 })
  }

  // Sign up via anon key — Supabase sends confirmation email automatically.
  const supabase = createClient(supabaseUrl, anonKey)
  const origin = getSiteOrigin(request)

  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      // After email confirmation the owner lands on their dashboard.
      emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
    },
  })

  if (error) {
    console.error('[register] auth.signUp failed:', error.message)
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 400 })
  }

  // Already-registered email (confirmation on): Supabase returns an obfuscated user with an
  // empty identities array and no error. Do NOT touch that account; answer exactly like a
  // fresh sign-up so account existence is not leaked.
  if (!data.user || (data.user.identities?.length ?? 0) === 0) {
    return NextResponse.json({ success: true, session: false })
  }

  // An existing public.users row means this auth user predates the request (e.g. a repeat
  // sign-up for an unconfirmed email, where Supabase returns the real user and re-sends the
  // confirmation). Never run the RPC or any cleanup against it; answer like a fresh sign-up.
  const { data: existingUser, error: lookupError } = await admin
    .from('users')
    .select('id')
    .eq('id', data.user.id)
    .maybeSingle()
  if (lookupError) {
    console.error('[register] users lookup failed:', lookupError.message)
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 })
  }
  if (existingUser) {
    return NextResponse.json({ success: true, session: false })
  }

  // users + agency + owner membership atomically. Failure => remove the auth user ONLY if
  // this request created it (best-effort) so the email can retry.
  const { error: rpcError } = await admin.rpc('create_agency_with_owner', {
    p_user_id: data.user.id,
    p_email: email.trim().toLowerCase(),
    p_full_name: fullName.trim(),
    p_agency_name: agencyName.trim(),
    p_slug: slug,
  })

  if (rpcError) {
    console.error('[register] create_agency_with_owner failed:', rpcError.code, rpcError.message)
    const createdAt = Date.parse(data.user.created_at ?? '')
    if (Number.isFinite(createdAt) && createdAt >= requestStart - CREATED_SKEW_MS) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id)
      if (deleteError) {
        console.error('[register] orphaned auth user cleanup failed:', deleteError.message)
      }
    } else {
      console.error('[register] skipping cleanup: auth user was not created by this request')
    }
    const detail = `${rpcError.message ?? ''} ${rpcError.details ?? ''}`
    if (rpcError.code === '23505' && detail.includes('agencies_slug_key')) {
      return NextResponse.json(AGENCY_TAKEN, { status: 409 })
    }
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 })
  }

  // `session: true` => email confirmation is off; the client then signs in via
  // /api/auth/signin (which sets cookies). Never return tokens.
  return NextResponse.json({ success: true, session: data.session !== null })
}
