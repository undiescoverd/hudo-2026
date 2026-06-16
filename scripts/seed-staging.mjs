/**
 * Seed the staging database with test login users + a walkable data set.
 *
 * Creates (idempotently — safe to re-run):
 *   - 1 test agency (Freemium)
 *   - 3 login users: owner, agent, talent (with memberships)
 *   - 1 video owned by the talent, in the agency, with 1 version
 *   - 2 timestamped comments by the agent (gives the export + dashboards data)
 *
 * Usage (point at STAGING — never prod). Override the bucket: the deployed staging
 * app signs URLs against the `hudo-staging` bucket, but local .env.staging carries a
 * stale `R2_BUCKET_NAME="hudo-dev"`, so override it on the command line:
 *   R2_BUCKET_NAME=hudo-staging node --env-file=.env.staging scripts/seed-staging.mjs
 *
 * One-time, before the first seed run: bootstrap the stable sample asset in R2
 * (a server-side copy from a known-good upload — no repo binary, no external dep):
 *   R2_BUCKET_NAME=hudo-staging node --env-file=.env.staging scripts/seed-staging.mjs --bootstrap
 *
 * The service_role key bypasses RLS — only run this against dev/staging.
 */
import { createClient } from '@supabase/supabase-js'
import { CopyObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'

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

// Stable, seed-owned R2 asset that backs the seeded video's playback. Bootstrapped
// once (server-side copy from BOOTSTRAP_SOURCE_KEY) so the seed is self-contained
// within the bucket — no random per-upload UUID path, no repo binary.
const SEED_ASSET_KEY = 'seed/staging/_assets/sample-v1.mp4'
// Real duration of the sample mp4 (~3s) — keeps DB metadata honest with the bytes.
const SAMPLE_DURATION_SECONDS = 3
// Known-good upload that plays, used only by `--bootstrap` to seed SEED_ASSET_KEY.
const BOOTSTRAP_SOURCE_KEY =
  '3e44aa4d-76ec-4acf-8959-eeac95b40a40/55c07ab0-90fc-4764-995c-03ab6a14754d/d6b735f2-7621-48b7-864e-0ab48ed2fd38.mp4'

/** Build an R2 (S3-compatible) client from env, mirroring lib/storage.ts. Returns null if unconfigured. */
function createR2() {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const accountId = process.env.R2_ACCOUNT_ID
  const bucket = process.env.R2_BUCKET_NAME
  const endpoint = process.env.R2_ENDPOINT
  if (!accessKeyId || !secretAccessKey || !accountId || !bucket) return null
  const client = new S3Client({
    region: 'auto',
    endpoint: endpoint || `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
  return { client, bucket }
}

/** HeadObject helper — returns the response metadata, or null if the object does not exist. */
async function headObject(client, bucket, key) {
  try {
    return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null
    throw err
  }
}

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
        description: 'Seeded video for staging walkthroughs (R2 object backfilled — playback works).',
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

  // 6) Backfill the video's R2 bytes (runs whether the video was just created or
  // already existed — the block above is guarded by `if (!video)`, so this must
  // live outside it to fix the already-seeded row). Idempotent.
  console.log('Backfilling R2 object…')
  await backfillVideoBytes(video.id)

  console.log('\n✓ Seed complete. Test logins (password for all):')
  console.log(`    password: ${PASSWORD}`)
  for (const u of USERS) console.log(`    ${u.role.padEnd(7)} ${u.email}`)
  console.log('\nWalk: sign in as agent (sees agency dashboard + the seeded video/comments),')
  console.log('post a comment as the agent → sign in as talent → notification bell should light up.')
  console.log('Video playback now works (seeded ~3s sample mp4) — open the video to play it.')
}

/** Ensure the seeded video's R2 object exists (idempotent) and sync DB metadata to it. */
async function backfillVideoBytes(videoId) {
  const r2 = createR2()
  if (!r2) {
    console.warn(
      '  • R2 env not configured — skipping R2 backfill (playback will 404 until seeded).'
    )
    return
  }
  const { client, bucket } = r2

  // Re-read from the DB — don't trust the in-memory `video` object: on a fresh create
  // its active_version_id is unset (the insert .select('id') only), so re-query it.
  const { data: vid } = await admin
    .from('videos')
    .select('active_version_id')
    .eq('id', videoId)
    .single()
  if (!vid?.active_version_id) {
    console.warn('  • no active_version_id on the seed video — skipping R2 backfill.')
    return
  }
  const { data: ver } = await admin
    .from('video_versions')
    .select('id, r2_key')
    .eq('id', vid.active_version_id)
    .single()
  if (!ver?.r2_key) {
    console.warn('  • active version has no r2_key — skipping R2 backfill.')
    return
  }

  let head = await headObject(client, bucket, ver.r2_key)
  if (head) {
    console.log(`  • object already present (${ver.r2_key})`)
  } else {
    const asset = await headObject(client, bucket, SEED_ASSET_KEY)
    if (!asset) {
      throw new Error(
        `seed asset missing: ${SEED_ASSET_KEY} in bucket "${bucket}". Bootstrap it once with: ` +
          `R2_BUCKET_NAME=${bucket} node --env-file=.env.staging scripts/seed-staging.mjs --bootstrap`
      )
    }
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${SEED_ASSET_KEY}`,
        Key: ver.r2_key,
        ContentType: 'video/mp4',
        MetadataDirective: 'REPLACE',
      })
    )
    head = await headObject(client, bucket, ver.r2_key)
    console.log(`  • copied ${SEED_ASSET_KEY} → ${ver.r2_key}`)
  }

  if (head?.ContentType && head.ContentType !== 'video/mp4') {
    console.warn(`  ⚠ unexpected ContentType on ${ver.r2_key}: ${head.ContentType}`)
  }
  await admin
    .from('video_versions')
    .update({
      file_size_bytes: head?.ContentLength ?? null,
      duration_seconds: SAMPLE_DURATION_SECONDS,
    })
    .eq('id', ver.id)
  console.log(
    `  • synced metadata (file_size_bytes=${head?.ContentLength}, duration_seconds=${SAMPLE_DURATION_SECONDS})`
  )
}

/** One-time: copy a known-good upload to the stable seed asset key. Run with `--bootstrap`. */
async function bootstrap() {
  const r2 = createR2()
  if (!r2) {
    console.error('✗ R2 env not configured — cannot bootstrap the seed asset.')
    process.exit(1)
  }
  const { client, bucket } = r2
  console.log(`→ Bootstrapping seed asset in bucket "${bucket}"…`)
  const source = await headObject(client, bucket, BOOTSTRAP_SOURCE_KEY)
  if (!source) {
    console.error(`✗ Bootstrap source missing in "${bucket}": ${BOOTSTRAP_SOURCE_KEY}`)
    process.exit(1)
  }
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${BOOTSTRAP_SOURCE_KEY}`,
      Key: SEED_ASSET_KEY,
      ContentType: 'video/mp4',
      MetadataDirective: 'REPLACE',
    })
  )
  const asset = await headObject(client, bucket, SEED_ASSET_KEY)
  console.log(
    `✓ Seed asset ready: ${SEED_ASSET_KEY} (ContentLength=${asset?.ContentLength}, ContentType=${asset?.ContentType})`
  )
}

const entry = process.argv.includes('--bootstrap') ? bootstrap : main
entry().catch((err) => {
  console.error('✗ Seed failed:', err.message ?? err)
  process.exit(1)
})
