import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const VALID_INVITE_ROLES = ['admin_agent', 'agent', 'talent'] as const
type InviteRole = (typeof VALID_INVITE_ROLES)[number]

/**
 * Roles that each membership role is allowed to invite.
 */
const INVITE_PERMISSIONS: Record<string, InviteRole[]> = {
  owner: ['admin_agent', 'agent', 'talent'],
  admin_agent: ['admin_agent', 'agent', 'talent'],
  agent: ['talent'],
}

/**
 * POST /api/invitations/send
 *
 * Sends an invitation to join an agency. Caller must be authenticated and
 * have sufficient role in the target agency.
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

  const { email, role, agencyId } = body as Record<string, unknown>

  // Validate inputs
  if (typeof email !== 'string' || !email.trim() || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }
  if (typeof role !== 'string' || !VALID_INVITE_ROLES.includes(role as InviteRole)) {
    return NextResponse.json({ error: 'Valid role is required' }, { status: 400 })
  }
  if (typeof agencyId !== 'string' || !agencyId.trim()) {
    return NextResponse.json({ error: 'Agency ID is required' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('[invitations/send] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  // Authenticate caller
  const cookieStore = await cookies()
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Check caller's role in the agency
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('agency_id', agencyId)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'You do not belong to this agency' }, { status: 403 })
  }

  const allowedRoles = INVITE_PERMISSIONS[membership.role]
  if (!allowedRoles || !allowedRoles.includes(role as InviteRole)) {
    return NextResponse.json(
      { error: 'You do not have permission to invite this role' },
      { status: 403 }
    )
  }

  // Check for existing pending invitation (same email + agency, not expired, not accepted)
  const { data: existing } = await admin
    .from('invitations')
    .select('id')
    .eq('email', email.trim().toLowerCase())
    .eq('agency_id', agencyId)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: 'An invitation for this email is already pending' },
      { status: 409 }
    )
  }

  // Generate token: 32-byte random, SHA-256 hashed for storage
  const tokenBytes = crypto.randomBytes(32)
  const tokenHex = tokenBytes.toString('hex')
  const tokenHash = crypto.createHash('sha256').update(tokenBytes).digest('hex')

  // Insert invitation
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  const { error: insertError } = await admin.from('invitations').insert({
    agency_id: agencyId,
    invited_by: user.id,
    email: email.trim().toLowerCase(),
    role,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
  })

  if (insertError) {
    console.error('[invitations/send] Insert failed:', insertError.message)
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
  }

  // Get agency name for the email
  const { data: agency } = await admin.from('agencies').select('name').eq('id', agencyId).single()

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const inviteUrl = `${appUrl}/auth/invite/${tokenHex}`

  // Send email — graceful fallback if Resend not configured
  try {
    const { sendEmail } = await import('@/lib/email')
    await sendEmail({
      to: email.trim().toLowerCase(),
      subject: `You've been invited to join ${agency?.name ?? 'an agency'} on Hudo`,
      html: `
        <p>You've been invited to join <strong>${agency?.name ?? 'an agency'}</strong> on Hudo as a <strong>${role.replaceAll('_', ' ')}</strong>.</p>
        <p><a href="${inviteUrl}">Accept invitation</a></p>
        <p>This invitation expires in 7 days.</p>
        <p>If you didn't expect this invitation, you can safely ignore this email.</p>
      `,
      text: `You've been invited to join ${agency?.name ?? 'an agency'} on Hudo as a ${role.replaceAll('_', ' ')}.\n\nAccept invitation: ${inviteUrl}\n\nThis invitation expires in 7 days.`,
    })
  } catch (err) {
    // Graceful fallback: log invite URL if email fails (e.g. RESEND_API_KEY not set in dev)
    console.warn('[invitations/send] Email send failed, invite URL:', inviteUrl)
    console.warn('[invitations/send] Error:', err instanceof Error ? err.message : 'Unknown')
  }

  return NextResponse.json({ success: true })
}
