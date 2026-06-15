/**
 * Playwright notification test seed.
 * Creates two agency members + a video + version for NOTIF-002 manual testing.
 *
 * Run: node --env-file=.env.local scripts/playwright-notif-seed.mjs
 *
 * Outputs (paste into .env.local for Playwright use):
 *   PW_AGENT_EMAIL / PW_AGENT_PASSWORD  — signs in via browser
 *   PW_RECIPIENT_EMAIL                  — passive member who receives notifications
 *   PW_AGENCY_ID
 *   PW_VIDEO_ID
 *   PW_VERSION_ID
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

const ts = Date.now()
const AGENT_EMAIL = `pw-agent-${ts}@hudo-dev.local`
const RECIPIENT_EMAIL = `pw-recipient-${ts}@hudo-dev.local`
const PASSWORD = 'TestPassword123!'

// ── 1. Create auth users ──────────────────────────────────────────────────────
for (const [email, name] of [
  [AGENT_EMAIL, 'PW Agent'],
  [RECIPIENT_EMAIL, 'PW Recipient'],
]) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  })
  if (error) { console.error(`createUser(${email}):`, error.message); process.exit(1) }
  await admin.from('users').insert({ id: data.user.id, email, full_name: name })
  console.error(`created user ${email} → ${data.user.id}`)
}

// ── 2. Look up user IDs ───────────────────────────────────────────────────────
const { data: users } = await admin
  .from('users')
  .select('id, email')
  .in('email', [AGENT_EMAIL, RECIPIENT_EMAIL])

const agentUser = users.find(u => u.email === AGENT_EMAIL)
const recipientUser = users.find(u => u.email === RECIPIENT_EMAIL)

// ── 3. Agency ─────────────────────────────────────────────────────────────────
const { data: agency, error: agencyErr } = await admin
  .from('agencies')
  .insert({ name: `PW Test Agency ${ts}`, slug: `pw-agency-${ts}` })
  .select('id')
  .single()
if (agencyErr) { console.error('agency:', agencyErr.message); process.exit(1) }

// ── 4. Memberships ────────────────────────────────────────────────────────────
await admin.from('memberships').insert([
  { user_id: agentUser.id, agency_id: agency.id, role: 'agent' },
  { user_id: recipientUser.id, agency_id: agency.id, role: 'agent' },
])

// ── 5. Recipient prefs: batch_window=1 min so cron fires immediately ──────────
await admin.from('notification_preferences').insert({
  user_id: recipientUser.id,
  email_enabled: true,
  batch_window_minutes: 1,
})

// ── 6. Video + version ────────────────────────────────────────────────────────
const { data: video, error: videoErr } = await admin
  .from('videos')
  .insert({
    agency_id: agency.id,
    talent_id: agentUser.id,
    title: 'PW Notification Test Video',
    status: 'pending_review',
  })
  .select('id')
  .single()
if (videoErr) { console.error('video:', videoErr.message); process.exit(1) }

// Use the RPC to create the version (avoids race on version_number)
const { data: version, error: versionErr } = await admin.rpc('create_video_version', {
  p_video_id: video.id,
  p_agency_id: agency.id,
  p_r2_key: `pw-test/${ts}/v1.mp4`,
  p_file_size_bytes: 1024 * 1024,
  p_uploaded_by: agentUser.id,
})
if (versionErr) { console.error('version rpc:', versionErr.message); process.exit(1) }

const versionId = version.id

// Set active_version_id on the video
await admin.from('videos').update({ active_version_id: versionId }).eq('id', video.id)

// ── 7. Output ─────────────────────────────────────────────────────────────────
console.log('')
console.log('# Paste into .env.local:')
console.log(`PW_AGENT_EMAIL=${AGENT_EMAIL}`)
console.log(`PW_AGENT_PASSWORD=${PASSWORD}`)
console.log(`PW_RECIPIENT_EMAIL=${RECIPIENT_EMAIL}`)
console.log(`PW_AGENCY_ID=${agency.id}`)
console.log(`PW_VIDEO_ID=${video.id}`)
console.log(`PW_VERSION_ID=${versionId}`)
