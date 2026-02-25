/**
 * One-off seed: create test user + agency + membership (and a second agency for 403 test).
 * Run: node --env-file=.env.local scripts/upload-test-seed.mjs
 * Outputs: TEST_EMAIL TEST_PASSWORD TEST_AGENCY_ID WRONG_AGENCY_ID (for use with upload-manual-check.sh)
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const TEST_EMAIL = `upload-test-${Date.now()}@hudo-dev.local`
const TEST_PASSWORD = 'TestPassword123!'

// Create auth user (auto-confirmed)
const { data: authData, error: authErr } = await admin.auth.admin.createUser({
  email: TEST_EMAIL,
  password: TEST_PASSWORD,
  email_confirm: true,
})
if (authErr) {
  console.error('createUser failed:', authErr.message)
  process.exit(1)
}
const userId = authData.user.id

// public.users
await admin.from('users').insert({ id: userId, email: TEST_EMAIL, full_name: 'Upload Test User' })

// Agency the user belongs to
const { data: agency, error: agencyErr } = await admin
  .from('agencies')
  .insert({ name: 'Upload Test Agency', slug: `upload-test-${Date.now()}` })
  .select('id')
  .single()
if (agencyErr) {
  console.error('agency insert failed:', agencyErr.message)
  process.exit(1)
}

// Membership (owner)
await admin.from('memberships').insert({ user_id: userId, agency_id: agency.id, role: 'owner' })

// Second agency (user is NOT a member — for 403 test)
const { data: wrongAgency, error: wrongErr } = await admin
  .from('agencies')
  .insert({ name: 'Other Agency', slug: `other-agency-${Date.now()}` })
  .select('id')
  .single()
if (wrongErr) {
  console.error('second agency insert failed:', wrongErr.message)
  process.exit(1)
}

console.log(`TEST_EMAIL=${TEST_EMAIL}`)
console.log(`TEST_PASSWORD=${TEST_PASSWORD}`)
console.log(`TEST_AGENCY_ID=${agency.id}`)
console.log(`WRONG_AGENCY_ID=${wrongAgency.id}`)
