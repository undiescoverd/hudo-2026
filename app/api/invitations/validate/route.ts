import { createClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

/**
 * GET /api/invitations/validate?token=...
 *
 * Validates an invitation token. Returns invitation details if valid,
 * or a generic invalid response for expired/used/nonexistent tokens
 * to prevent enumeration.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  if (!token || typeof token !== 'string' || token.length !== 64) {
    return NextResponse.json({ valid: false })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[invitations/validate] Missing Supabase environment variables')
    return NextResponse.json({ valid: false })
  }

  const tokenHash = crypto.createHash('sha256').update(Buffer.from(token, 'hex')).digest('hex')

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: invitation } = await admin
    .from('invitations')
    .select('id, email, role, agency_id, expires_at, accepted_at')
    .eq('token_hash', tokenHash)
    .single()

  if (!invitation) {
    return NextResponse.json({ valid: false })
  }

  // Check expired or already accepted
  if (invitation.accepted_at || new Date(invitation.expires_at) < new Date()) {
    return NextResponse.json({ valid: false })
  }

  // Get agency name
  const { data: agency } = await admin
    .from('agencies')
    .select('name')
    .eq('id', invitation.agency_id)
    .single()

  // Check if user already exists in auth
  const { data: existingUsers } = await admin
    .from('users')
    .select('id')
    .eq('email', invitation.email)
    .limit(1)

  return NextResponse.json({
    valid: true,
    email: invitation.email,
    role: invitation.role,
    agencyName: agency?.name ?? 'Unknown agency',
    userExists: (existingUsers?.length ?? 0) > 0,
  })
}
