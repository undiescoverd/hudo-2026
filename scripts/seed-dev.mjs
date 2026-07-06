/**
 * Seed hudo-dev with one test agency + one login user per role, for local
 * quick sign-in (see components/auth/DevQuickSignIn.tsx). Idempotent — safe to re-run.
 *
 * Usage: node --env-file=.env.local scripts/seed-dev.mjs
 *
 * The service_role key bypasses RLS. This creates accounts with a shared,
 * hardcoded password (public in this repo) — it must ONLY ever run against
 * hudo-dev, never staging (the de-facto working "prod" per CLAUDE.md) or prod.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRoleKey) {
  console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
  process.exit(1)
}

// Safety: ALLOWLIST hudo-dev only — this seeds accounts with a hardcoded,
// publicly-known password, so refusing everything except the one intended
// project (not just refusing prod) matters. Never loosen this to "not prod".
const DEV_REF = 'xyeqnjboqimvhdwnyqbt'
if (!url.includes(DEV_REF)) {
  console.error(
    `✗ Refusing to seed: URL is not hudo-dev (expected project ref ${DEV_REF}). ` +
      'This script creates hardcoded-password accounts and must never run against staging or prod.'
  )
  process.exit(1)
}
console.log(`→ Seeding project: ${url.replace(/^https?:\/\//, '').split('.')[0]}`)

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

export const DEV_PASSWORD = 'HudoDevQuick2026!'
export const DEV_USERS = [
  { key: 'owner', email: 'owner@hudo-dev.test', full_name: 'Olivia Owner', role: 'owner' },
  {
    key: 'admin_agent',
    email: 'admin@hudo-dev.test',
    full_name: 'Adam Admin',
    role: 'admin_agent',
  },
  { key: 'agent', email: 'agent@hudo-dev.test', full_name: 'Aaron Agent', role: 'agent' },
  { key: 'talent', email: 'talent@hudo-dev.test', full_name: 'Tara Talent', role: 'talent' },
]
const AGENCY_SLUG = 'hudo-dev-quick-login'

/** Create an auth user (or find the existing one) and ensure a public.users row. */
async function ensureUser({ email, full_name }) {
  let userId
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: DEV_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name },
  })
  if (createErr) {
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
    console.log(`  • user ${email} already existed (${userId}) — resetting password`)
    const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
      password: DEV_PASSWORD,
    })
    if (updateErr) throw updateErr
  } else {
    userId = created.user.id
    console.log(`  • created user ${email} (${userId})`)
  }
  await admin.from('users').upsert({ id: userId, email, full_name }, { onConflict: 'id' })
  return userId
}

async function main() {
  console.log('Creating users…')
  const ids = {}
  for (const u of DEV_USERS) ids[u.key] = await ensureUser(u)

  console.log('Creating agency…')
  let { data: agency } = await admin
    .from('agencies')
    .select('id')
    .eq('slug', AGENCY_SLUG)
    .maybeSingle()
  if (!agency) {
    const { data, error } = await admin
      .from('agencies')
      .insert({ name: 'Hudo Dev Quick Login', slug: AGENCY_SLUG, plan: 'freemium' })
      .select('id')
      .single()
    if (error) throw error
    agency = data
    console.log(`  • created agency ${agency.id}`)
  } else {
    console.log(`  • agency already existed ${agency.id}`)
  }

  console.log('Creating memberships…')
  for (const u of DEV_USERS) {
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

  console.log('\n✓ Dev quick-login users ready:')
  for (const u of DEV_USERS) console.log(`    ${u.role.padEnd(12)} ${u.email}`)
  console.log(`\n  password (all roles): ${DEV_PASSWORD}`)
  console.log('  Sign in at http://localhost:3000/auth/signin — dev-only quick-login buttons')
  console.log('  appear automatically under `pnpm dev`.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
