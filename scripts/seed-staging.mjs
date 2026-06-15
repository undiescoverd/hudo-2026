/**
 * Seed the staging database with test login users + a walkable data set.
 *
 * Creates (idempotently — safe to re-run):
 *   - 1 test agency (Freemium)
 *   - 3 login users: owner, agent, talent (with memberships)
 *   - 1 video owned by the talent, in the agency, with 1 version
 *   - 2 timestamped comments by the agent (gives the export + dashboards data)
 *
 * Usage (point at STAGING — never prod):
 *   NEXT_PUBLIC_SUPABASE_URL="https://egabjtxrrcuzooyclwgw.supabase.co" \
 *   SUPABASE_SERVICE_ROLE_KEY="<staging service_role key>" \
 *   node scripts/seed-staging.mjs
 *
 * The service_role key bypasses RLS — only run this against dev/staging.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRoleKey) {
  console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
  process.exit(1)
}

// Safety: refuse to run against the (paused) production project.
const PROD_REF = 'ljesrugaovuoyqhitlsj'
if (url.includes(PROD_REF)) {
  console.error('✗ Refusing to seed: URL points at hudo-prod. Seed is for dev/staging only.')
  process.exit(1)
}
console.log(`→ Seeding project: ${url.replace(/^https?:\/\//, '').split('.')[0]}`)

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const PASSWORD = 'HudoStaging2026!'
const USERS = [
  { key: 'owner', email: 'owner@hudo.test', full_name: 'Olivia Owner', role: 'owner' },
  { key: 'agent', email: 'agent@hudo.test', full_name: 'Aaron Agent', role: 'agent' },
  { key: 'talent', email: 'talent@hudo.test', full_name: 'Tara Talent', role: 'talent' },
]
const AGENCY_SLUG = 'hudo-staging-test'
const VIDEO_TITLE = 'Staging Test Reel'

/** Create an auth user (or find the existing one) and ensure a public.users row. */
async function ensureUser({ email, full_name }) {
  let userId
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name },
  })
  if (createErr) {
    // Already registered — look it up by paging through admin.listUsers.
    if (!/already|registered|exist/i.test(createErr.message)) throw createErr
    let page = 1
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (error) throw error
      const found = data.users.find((u) => u.email === email)
      if (found) {
        userId = found.id
        break
      }
      if (data.users.length < 200) break
      page += 1
    }
    if (!userId) throw new Error(`could not create or find user ${email}`)
    console.log(`  • user ${email} already existed (${userId})`)
  } else {
    userId = created.user.id
    console.log(`  • created user ${email} (${userId})`)
  }
  await admin.from('users').upsert({ id: userId, email, full_name }, { onConflict: 'id' })
  return userId
}

async function main() {
  // 1) Users
  console.log('Creating users…')
  const ids = {}
  for (const u of USERS) ids[u.key] = await ensureUser(u)

  // 2) Agency (idempotent by slug)
  console.log('Creating agency…')
  let { data: agency } = await admin
    .from('agencies')
    .select('id')
    .eq('slug', AGENCY_SLUG)
    .maybeSingle()
  if (!agency) {
    const { data, error } = await admin
      .from('agencies')
      .insert({ name: 'Hudo Staging Test Agency', slug: AGENCY_SLUG, plan: 'freemium' })
      .select('id')
      .single()
    if (error) throw error
    agency = data
    console.log(`  • created agency ${agency.id}`)
  } else {
    console.log(`  • agency already existed ${agency.id}`)
  }

  // 3) Memberships (idempotent on user_id+agency_id)
  console.log('Creating memberships…')
  for (const u of USERS) {
    const { data: existing } = await admin
      .from('memberships')
      .select('id')
      .eq('user_id', ids[u.key])
      .eq('agency_id', agency.id)
      .maybeSingle()
    if (!existing) {
      const { error } = await admin
        .from('memberships')
        .insert({ user_id: ids[u.key], agency_id: agency.id, role: u.role })
      if (error) throw error
      console.log(`  • ${u.role} membership for ${u.email}`)
    }
  }

  // 4) Video + version (idempotent by title within the agency)
  console.log('Creating video + version…')
  let { data: video } = await admin
    .from('videos')
    .select('id, active_version_id')
    .eq('agency_id', agency.id)
    .eq('title', VIDEO_TITLE)
    .maybeSingle()
  if (!video) {
    const { data: v, error: vErr } = await admin
      .from('videos')
      .insert({
        agency_id: agency.id,
        talent_id: ids.talent,
        title: VIDEO_TITLE,
        status: 'in_review',
        description: 'Seeded video for staging walkthroughs (no real R2 object — playback will 404).',
      })
      .select('id')
      .single()
    if (vErr) throw vErr
    video = v

    const { data: ver, error: verErr } = await admin
      .from('video_versions')
      .insert({
        video_id: video.id,
        agency_id: agency.id,
        version_number: 1,
        r2_key: `seed/staging/${video.id}/v1.mp4`,
        file_size_bytes: 10485760,
        duration_seconds: 90,
        uploaded_by: ids.talent,
      })
      .select('id')
      .single()
    if (verErr) throw verErr

    await admin.from('videos').update({ active_version_id: ver.id }).eq('id', video.id)

    // 5) Comments by the agent (point comments at timestamps)
    const { error: cErr } = await admin.from('comments').insert([
      {
        video_version_id: ver.id,
        agency_id: agency.id,
        user_id: ids.agent,
        content: 'Great energy here — can we trim the intro by a beat?',
        comment_type: 'point',
        timestamp_seconds: 4.2,
      },
      {
        video_version_id: ver.id,
        agency_id: agency.id,
        user_id: ids.agent,
        content: 'Nice delivery on this line.',
        comment_type: 'point',
        timestamp_seconds: 31.0,
      },
    ])
    if (cErr) throw cErr
    console.log(`  • created video ${video.id} + version 1 + 2 comments`)
  } else {
    console.log(`  • video already existed ${video.id}`)
  }

  console.log('\n✓ Seed complete. Test logins (password for all):')
  console.log(`    password: ${PASSWORD}`)
  for (const u of USERS) console.log(`    ${u.role.padEnd(7)} ${u.email}`)
  console.log('\nWalk: sign in as agent (sees agency dashboard + the seeded video/comments),')
  console.log('post a comment as the agent → sign in as talent → notification bell should light up.')
  console.log('Video playback will 404 (no real R2 object) — dashboards, comments, notifications,')
  console.log('preferences, seat gates and PDF export all work without it.')
}

main().catch((err) => {
  console.error('✗ Seed failed:', err.message ?? err)
  process.exit(1)
})
