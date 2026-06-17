/**
 * Create a beta agency and invite its owner.
 *
 * What it does:
 *   1. Creates an agency row (plan=studio, is_founding_member=true)
 *   2. Sends a Supabase auth invite to the owner's email
 *   3. Pre-creates the public.users row so the owner lands in a working state
 *   4. Creates the owner membership
 *
 * The invited owner clicks the email link → sets a password → lands on /videos
 * with their agency and Studio-level access already in place.
 *
 * Prereqs:
 *   - Migration 0020_agencies_founding_member applied to the target project
 *   - .env.staging (or .env.local) with NEXT_PUBLIC_SUPABASE_URL,
 *     SUPABASE_SERVICE_ROLE_KEY, and NEXT_PUBLIC_APP_URL
 *
 * Usage:
 *   node --env-file=.env.staging scripts/create-beta-agency.mjs \
 *     "Stellar Talent" "owner@stellartalent.co.uk" "Jane Smith"
 *
 * Safe to re-run: skips steps that already exist (idempotent on agency slug).
 */

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const [agencyName, ownerEmail, ownerFullName] = process.argv.slice(2)

if (!agencyName || !ownerEmail || !ownerFullName) {
  console.error('Usage: node --env-file=.env.staging scripts/create-beta-agency.mjs "Agency Name" "owner@email.com" "Owner Full Name"')
  process.exit(1)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
if (!EMAIL_RE.test(ownerEmail)) {
  console.error(`✗ Invalid email: ${ownerEmail}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

if (!supabaseUrl || !serviceRoleKey) {
  console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// Safety: never run against production.
const PROD_REF = 'ljesrugaovuoyqhitlsj'
if (supabaseUrl.includes(PROD_REF)) {
  console.error('✗ Refusing to run against hudo-prod. Use dev or staging only.')
  process.exit(1)
}

const projectRef = supabaseUrl.replace(/^https?:\/\//, '').split('.')[0]
console.log(`→ Target project: ${projectRef}`)
console.log(`→ Agency:         ${agencyName}`)
console.log(`→ Owner email:    ${ownerEmail}`)
console.log(`→ Owner name:     ${ownerFullName}`)
console.log()

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

function toSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function uniqueSlug(base) {
  let slug = base
  let attempt = 0
  while (true) {
    const { data } = await admin.from('agencies').select('id').eq('slug', slug).maybeSingle()
    if (!data) return slug
    attempt++
    slug = `${base}-${attempt}`
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const baseSlug = toSlug(agencyName)
const slug = await uniqueSlug(baseSlug)

// 1. Agency
let agencyId
const { data: existing } = await admin.from('agencies').select('id, slug').eq('slug', slug).maybeSingle()

if (existing) {
  agencyId = existing.id
  console.log(`  ↩ Agency already exists (${slug}) — skipping create`)
} else {
  agencyId = randomUUID()
  const { error } = await admin.from('agencies').insert({
    id: agencyId,
    name: agencyName,
    slug,
    plan: 'studio',
    is_founding_member: true,
  })
  if (error) {
    console.error('✗ Failed to create agency:', error.message)
    process.exit(1)
  }
  console.log(`  ✓ Agency created: ${agencyName} (${slug}) — plan=studio, founding_member=true`)
}

// 2. Auth invite
let userId
const { data: existingUser } = await admin.from('users').select('id').eq('email', ownerEmail.toLowerCase()).maybeSingle()

if (existingUser) {
  userId = existingUser.id
  console.log(`  ↩ User already exists (${ownerEmail}) — skipping invite`)
} else {
  const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(ownerEmail, {
    redirectTo: `${appUrl}/auth/callback?next=/videos`,
    data: { full_name: ownerFullName },
  })

  if (inviteError) {
    console.error('✗ Failed to send invite:', inviteError.message)
    process.exit(1)
  }

  userId = invite.user.id
  console.log(`  ✓ Invite sent to ${ownerEmail} (auth user: ${userId})`)

  // 3. public.users row (pre-create so first login works without a trigger)
  const { error: userError } = await admin.from('users').insert({
    id: userId,
    email: ownerEmail.toLowerCase(),
    full_name: ownerFullName,
  })
  if (userError) {
    console.error('✗ Failed to create users row:', userError.message)
    process.exit(1)
  }
  console.log(`  ✓ public.users row created`)
}

// 4. Membership
const { data: existingMembership } = await admin
  .from('memberships')
  .select('id')
  .eq('agency_id', agencyId)
  .eq('user_id', userId)
  .maybeSingle()

if (existingMembership) {
  console.log(`  ↩ Membership already exists — skipping`)
} else {
  const { error: memberError } = await admin.from('memberships').insert({
    agency_id: agencyId,
    user_id: userId,
    role: 'owner',
  })
  if (memberError) {
    console.error('✗ Failed to create membership:', memberError.message)
    process.exit(1)
  }
  console.log(`  ✓ Membership created: owner of ${agencyName}`)
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log()
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  Beta agency ready')
console.log(`  Agency:  ${agencyName} (${slug})`)
console.log(`  Plan:    studio  |  founding_member: true`)
console.log(`  Owner:   ${ownerFullName} <${ownerEmail}>`)
console.log(`  Invite:  sent — owner must click link to set password`)
console.log()
console.log('  When billing goes live, apply FOUNDING_50 coupon')
console.log('  (50% off for 12 months) to their Stripe subscription.')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
