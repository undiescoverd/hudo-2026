/**
 * Fixtures and helpers for the seven-flow staging smoke suite (S4-LAUNCH-002).
 *
 * Required env (all read from the environment, nothing hardcoded, see smoke.yml):
 *   PLAYWRIGHT_TEST_URL            staging base URL (read by the smoke config)
 *   SMOKE_SUPABASE_URL             staging Supabase project URL
 *   SMOKE_SUPABASE_SERVICE_ROLE_KEY  staging service-role key (cleanup + test seams)
 *   SMOKE_TEST_PASSWORD            password for the users the run creates
 *                                  (8+ chars, one uppercase, one number)
 * Optional env:
 *   SMOKE_EMAIL_DOMAIN             domain for generated addresses (default example.com;
 *                                  use a domain you control, invites/confirmations are mailed)
 *   SMOKE_EXPECT_WEBHOOK           "true" once the staging Stripe test webhook is configured:
 *                                  the upgrade flow then also asserts agencies.plan flips
 *   SMOKE_CRON_SECRET              if set, cleanup also drains the storage_deletions queue by
 *                                  calling GET /api/cron/storage-purge (otherwise the daily cron does)
 */
import { createHash, randomBytes } from 'crypto'
import { test as base } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v)
    throw new Error(`${name} is required for the smoke suite (see tests/e2e/fixtures/smoke.ts)`)
  return v
}

export interface SmokeRun {
  runId: string
  password: string
  agencyName: string
  ownerName: string
  ownerEmail: string
  talentName: string
  talentEmail: string
  /** Filled in by the flows as they go. */
  agencyId?: string
  ownerId?: string
  videoId?: string
  versionId?: string
  inviteToken?: string
  guestUrl?: string
  commentText: string
  admin: SupabaseClient
}

export function adminClient(): SupabaseClient {
  return createClient(
    requireEnv('SMOKE_SUPABASE_URL'),
    requireEnv('SMOKE_SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )
}

function newRun(): SmokeRun {
  const runId = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
  const domain = process.env.SMOKE_EMAIL_DOMAIN || 'example.com'
  return {
    runId,
    password: requireEnv('SMOKE_TEST_PASSWORD'),
    agencyName: `Smoke ${runId}`,
    ownerName: `Smoke Owner ${runId}`,
    ownerEmail: `smoke-owner-${runId}@${domain}`,
    talentName: `Smoke Talent ${runId}`,
    talentEmail: `smoke-talent-${runId}@${domain}`,
    commentText: `Smoke comment ${runId}`,
    admin: adminClient(),
  }
}

/** Invite tokens are 32 random bytes, hex in the URL, SHA-256 of the raw bytes in the DB. */
export function newInviteToken(): { token: string; hash: string } {
  const bytes = randomBytes(32)
  return { token: bytes.toString('hex'), hash: createHash('sha256').update(bytes).digest('hex') }
}

/**
 * Cleanup. Runs after the whole run, pass or fail.
 *
 * Deletes go ONLY through the sanctioned path: the purge_agency() RPC (migration 0025), which
 * queues the agency's R2 prefix in storage_deletions and cascades every agency-scoped row
 * (videos, versions, comments, guest links, invitations, memberships, audit log). No direct
 * DELETE on videos and no direct R2 delete. Because the owner is the sole owner, the erasure
 * endpoint (409 sole-owner guard) cannot remove them, so after the purge (when nothing
 * references the test users any more) the two throwaway accounts are removed with the auth
 * admin API plus their public.users rows.
 *
 * Safety: only an agency whose id is found through OUR generated owner email AND whose name
 * equals our generated name is ever purged.
 */
export async function cleanupRun(run: SmokeRun): Promise<void> {
  const { admin } = run
  const emails = [run.ownerEmail, run.talentEmail]

  const { data: users, error: usersError } = await admin
    .from('users')
    .select('id, email')
    .in('email', emails)
  if (usersError) throw new Error(`smoke cleanup: users lookup failed: ${usersError.message}`)
  const userIds = (users ?? []).map((u) => u.id as string)

  if (userIds.length > 0) {
    const { data: memberships } = await admin
      .from('memberships')
      .select('agency_id')
      .in('user_id', userIds)
    const agencyIds = Array.from(new Set((memberships ?? []).map((m) => m.agency_id as string)))
    if (agencyIds.length > 0) {
      const { data: agencies } = await admin
        .from('agencies')
        .select('id')
        .in('id', agencyIds)
        .eq('name', run.agencyName)
      for (const a of agencies ?? []) {
        const { error } = await admin.rpc('purge_agency', { p_agency_id: a.id })
        if (error) throw new Error(`smoke cleanup: purge_agency(${a.id}) failed: ${error.message}`)
      }
    }
  }

  // Drain the R2 queue now if we were given the cron secret; otherwise the daily cron does it.
  const cronSecret = process.env.SMOKE_CRON_SECRET
  const baseUrl = process.env.PLAYWRIGHT_TEST_URL
  if (cronSecret && baseUrl) {
    const res = await fetch(new URL('/api/cron/storage-purge', baseUrl), {
      headers: { authorization: `Bearer ${cronSecret}` },
    }).catch(() => null)
    if (!res || !res.ok)
      console.warn('smoke cleanup: storage-purge drain did not return 2xx (daily cron will retry)')
  }

  // Throwaway accounts: nothing references them once the agency is purged.
  for (const id of userIds) {
    const { error: rowError } = await admin.from('users').delete().eq('id', id)
    if (rowError)
      console.warn(`smoke cleanup: public.users row ${id} not removed: ${rowError.message}`)
    const { error: authError } = await admin.auth.admin.deleteUser(id)
    if (authError) console.warn(`smoke cleanup: auth user ${id} not removed: ${authError.message}`)
  }
}

/** Worker-scoped run state with a guaranteed cleanup teardown. */
export const test = base.extend<object, { run: SmokeRun }>({
  run: [
    async ({}, use) => {
      const run = newRun()
      try {
        await use(run)
      } finally {
        await cleanupRun(run)
      }
    },
    { scope: 'worker' },
  ],
})

export { expect } from '@playwright/test'
