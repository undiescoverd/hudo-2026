import { createClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { validatePassword } from '@/lib/auth-validation'
import crypto from 'crypto'

/**
 * POST /api/invitations/accept
 *
 * Accepts an invitation. For new users, creates auth user + public.users record.
 * For existing users, creates the membership only.
 * Marks the invitation as accepted and logs to audit_log.
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

  const { token, password, fullName } = body as Record<string, unknown>

  if (typeof token !== 'string' || token.length !== 64) {
    return NextResponse.json({ error: 'Invalid or expired invitation' }, { status: 410 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[invitations/accept] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const tokenHash = crypto.createHash('sha256').update(Buffer.from(token, 'hex')).digest('hex')

  const admin = createClient(supabaseUrl, serviceRoleKey)

  // Atomically claim the invitation: UPDATE only if not already accepted and not expired.
  // This prevents TOCTOU race conditions where two concurrent requests could both
  // read accepted_at IS NULL, then both proceed to create memberships.
  // PostgREST correctly casts ISO 8601 strings to timestamptz for comparison.
  // .gte() intentionally includes the exact expiry moment (invitations valid until expiry).
  const now = new Date().toISOString()
  const { data: claimed, error: claimError } = await admin
    .from('invitations')
    .update({ accepted_at: now })
    .eq('token_hash', tokenHash)
    .is('accepted_at', null)
    .gte('expires_at', now)
    .select('id, email, role, agency_id')

  if (claimError) {
    console.error('[invitations/accept] claim failed:', claimError.message)
    return NextResponse.json({ error: 'Failed to process invitation' }, { status: 500 })
  }

  const invitation = claimed?.[0]
  if (!invitation) {
    return NextResponse.json({ error: 'Invalid or expired invitation' }, { status: 410 })
  }

  // Check if user already exists
  const { data: existingUsers } = await admin
    .from('users')
    .select('id')
    .eq('email', invitation.email)
    .limit(1)

  const userExists = (existingUsers?.length ?? 0) > 0
  let userId: string

  if (!userExists) {
    // New user — require password and fullName
    if (typeof password !== 'string' || !password) {
      return NextResponse.json({ error: 'Password is required for new users' }, { status: 400 })
    }
    const passwordError = validatePassword(password)
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 })
    }
    if (typeof fullName !== 'string' || !fullName.trim()) {
      return NextResponse.json({ error: 'Full name is required for new users' }, { status: 400 })
    }

    // Create auth user via admin
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: invitation.email,
      password,
      email_confirm: true, // Auto-confirm since they were invited
    })

    if (authError) {
      console.error('[invitations/accept] createUser failed:', authError.message)
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
    }

    userId = authData.user.id

    // Create public.users record
    const { error: insertError } = await admin.from('users').insert({
      id: userId,
      email: invitation.email,
      full_name: fullName.trim(),
    })

    if (insertError) {
      console.error('[invitations/accept] users insert failed:', insertError.message)
      // Auth user exists, proceed with membership — reconciliation can fix missing users record
    }
  } else {
    userId = existingUsers![0].id
  }

  // Create membership
  const { error: membershipError } = await admin.from('memberships').insert({
    user_id: userId,
    agency_id: invitation.agency_id,
    role: invitation.role,
  })

  if (membershipError) {
    // Could be duplicate membership (UNIQUE constraint)
    if (membershipError.code === '23505') {
      return NextResponse.json(
        { error: 'You are already a member of this agency' },
        { status: 409 }
      )
    }
    console.error('[invitations/accept] membership insert failed:', membershipError.message)
    return NextResponse.json({ error: 'Failed to add to agency' }, { status: 500 })
  }

  // Insert audit log entry (invitation already marked accepted by the atomic claim above)
  const { data: inviter } = await admin.from('users').select('full_name').eq('id', userId).single()

  const { error: auditError } = await admin.from('audit_log').insert({
    agency_id: invitation.agency_id,
    actor_id: userId,
    actor_name: inviter?.full_name ?? 'Unknown',
    action: 'invitation_accepted',
    resource_type: 'membership',
    resource_id: invitation.id,
    metadata: { email: invitation.email, role: invitation.role },
  })

  if (auditError) {
    // Log but don't fail — membership is already created, audit is non-critical
    console.error('[invitations/accept] audit_log insert failed:', auditError.message)
  }

  return NextResponse.json({ success: true })
}
