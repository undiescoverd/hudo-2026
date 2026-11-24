/**
 * S4-LAUNCH-002: seven-flow smoke suite against staging.
 *
 *   1 register -> agency created        5 PDF export
 *   2 invite talent -> accept            6 guest link
 *   3 upload                             7 upgrade in Stripe test mode
 *   4 comment and resolve
 *
 * The flows build on each other (one agency, one video), so they run serially on one worker.
 * Env vars are documented in tests/e2e/fixtures/smoke.ts and .github/workflows/smoke.yml.
 *
 * Assumptions (human-confirmed settings, see the task NOTES):
 * - Supabase "confirm email" on staging may be ON or OFF. Flow 1 handles both: if the app
 *   shows "Check your email", the test confirms that one throwaway user through the service
 *   role (the confirmation mail is not readable from a test) and signs in through the UI.
 * - Invitation emails are not readable either. After the UI sends the invite, the test swaps
 *   that invitation's token_hash for one it generated, so it can open /auth/invite/<token>.
 *   Only the token changes; the send route, the row and the accept route are the real ones.
 * - The staging Stripe test webhook is human-configured. Without SMOKE_EXPECT_WEBHOOK=true,
 *   flow 7 stops at the successful return from Stripe Checkout; with it, flow 7 also waits
 *   for agencies.plan to leave 'freemium'.
 * - The PDF export is API-only today (no UI button is mounted), so flow 5 calls the route with
 *   the owner's session cookies.
 * - Unverified against a live staging run from the authoring environment: the Stripe-hosted
 *   Checkout selectors in flow 7 are the most likely thing to need a tweak.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, newInviteToken } from '../fixtures/smoke'
import { tinyMp4, TINY_MP4_NAME } from '../fixtures/tiny-video'
import { AuthPage } from '../pages/AuthPage'
import { DashboardPage } from '../pages/DashboardPage'
import { UploadPage } from '../pages/UploadPage'
import { PlayerPage } from '../pages/PlayerPage'
import { GuestPage } from '../pages/GuestPage'

test.describe.serial('S4-LAUNCH-002 staging smoke', () => {
  let ownerCtx: BrowserContext
  let owner: Page

  test.beforeAll(async ({ browser }) => {
    ownerCtx = await browser.newContext()
    owner = await ownerCtx.newPage()
  })

  test.afterAll(async () => {
    await ownerCtx?.close()
  })

  test('1. register creates the agency', async ({ run }) => {
    const auth = new AuthPage(owner)
    await auth.register({
      fullName: run.ownerName,
      agencyName: run.agencyName,
      email: run.ownerEmail,
      password: run.password,
    })

    // Confirm-email OFF: the app signs in and lands on /dashboard.
    // Confirm-email ON: the app shows "Check your email".
    const landed = await Promise.race([
      owner.waitForURL(/\/dashboard/, { timeout: 30_000 }).then(() => 'dashboard' as const),
      owner
        .getByRole('heading', { name: 'Check your email' })
        .waitFor({ timeout: 30_000 })
        .then(() => 'confirm' as const),
    ])

    const { data: user, error } = await run.admin
      .from('users')
      .select('id')
      .eq('email', run.ownerEmail)
      .single()
    expect(error, 'public.users row created by create_agency_with_owner').toBeNull()
    run.ownerId = user!.id as string

    if (landed === 'confirm') {
      const { error: confirmError } = await run.admin.auth.admin.updateUserById(run.ownerId, {
        email_confirm: true,
      })
      expect(confirmError).toBeNull()
      await auth.signIn(run.ownerEmail, run.password)
    }
    await expect(owner).toHaveURL(/\/(dashboard|talent|videos)?/)

    const { data: membership } = await run.admin
      .from('memberships')
      .select('agency_id, role')
      .eq('user_id', run.ownerId)
      .single()
    expect(membership?.role).toBe('owner')
    run.agencyId = membership!.agency_id as string
    const { data: agency } = await run.admin
      .from('agencies')
      .select('name')
      .eq('id', run.agencyId)
      .single()
    expect(agency?.name).toBe(run.agencyName)
  })

  test('2. invite talent and accept', async ({ run, browser }) => {
    await new DashboardPage(owner).inviteMember(run.talentEmail, 'talent')

    const { token, hash } = newInviteToken()
    const { data: swapped, error } = await run.admin
      .from('invitations')
      .update({ token_hash: hash })
      .eq('agency_id', run.agencyId!)
      .eq('email', run.talentEmail)
      .is('accepted_at', null)
      .select('id')
    expect(error).toBeNull()
    expect(swapped).toHaveLength(1)
    run.inviteToken = token

    const talentCtx = await browser.newContext()
    try {
      const talent = await talentCtx.newPage()
      const auth = new AuthPage(talent)
      await auth.acceptInviteAsNewUser(token, run.talentName, run.password)
      // The accepted account can sign in.
      await auth.signIn(run.talentEmail, run.password)
    } finally {
      await talentCtx.close()
    }

    const { data: member } = await run.admin
      .from('memberships')
      .select('role')
      .eq('agency_id', run.agencyId!)
      .eq('role', 'talent')
    expect(member).toHaveLength(1)
  })

  test('3. upload a video (as the invited talent: agents never upload)', async ({
    run,
    browser,
  }) => {
    const talentCtx = await browser.newContext()
    try {
      const talent = await talentCtx.newPage()
      await new AuthPage(talent).signIn(run.talentEmail, run.password)
      run.videoId = await new UploadPage(talent).uploadAsTalent(
        { name: TINY_MP4_NAME, mimeType: 'video/mp4', buffer: tinyMp4() },
        `Smoke video ${run.runId}`
      )
    } finally {
      await talentCtx.close()
    }
    const { data: version, error } = await run.admin
      .from('video_versions')
      .select('id')
      .eq('video_id', run.videoId)
      .order('version_number', { ascending: false })
      .limit(1)
      .single()
    expect(error).toBeNull()
    run.versionId = version!.id as string
  })

  test('4. comment and resolve', async ({ run }) => {
    const player = new PlayerPage(owner)
    await player.goto(run.videoId!)
    await player.postComment(run.commentText)
    await player.resolveFirstComment()
  })

  test('5. PDF export', async ({ run }) => {
    const res = await owner.request.get(
      `/api/videos/${run.videoId}/versions/${run.versionId}/comments/export`
    )
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('application/pdf')
    const body = await res.body()
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(body.length).toBeGreaterThan(500)
  })

  test('6. guest link', async ({ run, browser }) => {
    const player = new PlayerPage(owner)
    await player.goto(run.videoId!)
    run.guestUrl = await player.createGuestLink()

    // Fresh context: no cookies, so this is exactly what an outside reviewer sees.
    const guestCtx = await browser.newContext()
    try {
      const guest = await guestCtx.newPage()
      await new GuestPage(guest).openAndExpectComment(run.guestUrl, run.commentText)
    } finally {
      await guestCtx.close()
    }
  })

  test('7. upgrade in Stripe test mode', async ({ run }) => {
    const agencyId = run.agencyId!
    // Checkout preconditions (legal entity + DPA) through the same endpoints the billing UI calls.
    const legal = await owner.request.patch(`/api/agencies/${agencyId}/billing`, {
      data: {
        legal_name: `Smoke Ltd ${run.runId}`,
        billing_address: {
          line1: '1 High Street',
          city: 'London',
          postal_code: 'SW1A 1AA',
          country: 'GB',
        },
      },
    })
    expect(legal.status(), 'legal entity saved (is NEXT_PUBLIC_BILLING_ENABLED=true?)').toBe(200)
    const dpa = await owner.request.post(`/api/agencies/${agencyId}/dpa-accept`)
    expect(dpa.status()).toBe(200)

    await owner.goto('/settings/billing')
    await owner
      .getByRole('button', { name: /^Upgrade to/ })
      .first()
      .click()
    await owner.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 })

    // Stripe-hosted Checkout, test card 4242 (a public Stripe test number, not a credential).
    await owner
      .getByLabel('Email')
      .fill(run.ownerEmail)
      .catch(() => undefined)
    await owner.getByPlaceholder('1234 1234 1234 1234').fill('4242424242424242')
    await owner.getByPlaceholder('MM / YY').fill('12 / 34')
    await owner.getByPlaceholder('CVC').fill('123')
    await owner
      .getByLabel('Cardholder name')
      .fill(run.ownerName)
      .catch(() => undefined)
    await owner
      .getByLabel('Postal code')
      .fill('SW1A 1AA')
      .catch(() => undefined)
    await owner.getByTestId('hosted-payment-submit-button').click()

    await owner.waitForURL(/\/settings\/billing\?checkout=success/, { timeout: 120_000 })

    if (process.env.SMOKE_EXPECT_WEBHOOK === 'true') {
      await expect
        .poll(
          async () => {
            const { data } = await run.admin
              .from('agencies')
              .select('plan')
              .eq('id', agencyId)
              .single()
            return data?.plan
          },
          { timeout: 90_000, message: 'webhook should move agencies.plan off freemium' }
        )
        .not.toBe('freemium')
    } else {
      test.info().annotations.push({
        type: 'note',
        description:
          'Plan flip not asserted: set SMOKE_EXPECT_WEBHOOK=true once the staging Stripe webhook is live.',
      })
    }
  })
})
