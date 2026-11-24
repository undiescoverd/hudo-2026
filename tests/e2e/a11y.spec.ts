/**
 * Automated WCAG 2.1 A + AA audit (axe) over the five page groups (S4-ACCESS-001).
 *
 * Required env (the suite skips, like the other credentialed e2e specs, when absent):
 *   A11Y_PASSWORD        password shared by the seed accounts (STAGING_SEED_PASSWORD)
 * Optional env:
 *   A11Y_AGENT_EMAIL     default agent@hudo.test
 *   A11Y_TALENT_EMAIL    default talent@hudo.test
 *   A11Y_VIDEO_ID        video with comments; default is the staging seed video
 *   E2E_GUEST_TEST_TOKEN existing guest token; otherwise a link is generated through the Share UI
 *   A11Y_STATE_DIR      local dir to cache signed-in storageState between runs (sign-in is limited
 *                       to 5 per 15 min per IP); never commit it, it holds session cookies
 *
 * Sign-in is rate limited, so each role signs in ONCE (beforeAll) and the session is reused.
 * Only critical/serious violations fail the run; moderate/minor are logged for follow-up.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import fs from 'fs'
import nodePath from 'path'
import AxeBuilder from '@axe-core/playwright'
import { PlayerPage } from './pages/PlayerPage'

const PASSWORD = process.env.A11Y_PASSWORD
const AGENT_EMAIL = process.env.A11Y_AGENT_EMAIL ?? 'agent@hudo.test'
const TALENT_EMAIL = process.env.A11Y_TALENT_EMAIL ?? 'talent@hudo.test'
const VIDEO_ID = process.env.A11Y_VIDEO_ID ?? '7cb31754-187e-4f68-9a76-6a3a1973e080'

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

test.skip(!PASSWORD, 'A11Y_PASSWORD is not set: skipping the axe audit')

type Violation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number]

function summarize(v: Violation): string {
  const nodes = v.nodes
    .map(
      (n) =>
        `    ${n.target.join(' ')}\n      ${n.html.slice(0, 160)}\n      ${n.failureSummary?.split('\n')[1] ?? ''}`
    )
    .join('\n')
  return `[${v.impact}] ${v.id}: ${v.help}\n${nodes}`
}

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  const isBlocking = (v: Violation) => v.impact === 'critical' || v.impact === 'serious'
  const minor = results.violations.filter((v) => !isBlocking(v))
  if (minor.length) console.log(`a11y (${label}) non-blocking:\n${minor.map(summarize).join('\n')}`)
  expect(
    results.violations.filter(isBlocking).map(summarize),
    `${label}: critical/serious axe violations`
  ).toEqual([])
}

async function signedInContext(browser: Browser, email: string): Promise<BrowserContext> {
  const stateFile = process.env.A11Y_STATE_DIR
    ? nodePath.join(process.env.A11Y_STATE_DIR, `${email}.json`)
    : undefined
  if (stateFile && fs.existsSync(stateFile)) {
    return browser.newContext({ storageState: stateFile })
  }
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto('/auth/signin')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD!)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/'), { timeout: 30_000 })
  await page.close()
  if (stateFile) {
    fs.mkdirSync(nodePath.dirname(stateFile), { recursive: true })
    await ctx.storageState({ path: stateFile })
  }
  return ctx
}

test.describe('axe WCAG 2.1 AA', () => {
  test.setTimeout(120_000)

  let agentCtx: BrowserContext
  let talentCtx: BrowserContext
  let guestPath = ''

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000)
    agentCtx = await signedInContext(browser, AGENT_EMAIL)
    talentCtx = await signedInContext(browser, TALENT_EMAIL)
    if (process.env.E2E_GUEST_TEST_TOKEN) {
      guestPath = `/guest/${process.env.E2E_GUEST_TEST_TOKEN}`
    } else {
      const page = await agentCtx.newPage()
      const player = new PlayerPage(page)
      await player.goto(VIDEO_ID)
      guestPath = new URL(await player.createGuestLink()).pathname
      await page.close()
    }
  })

  test.afterAll(async () => {
    await agentCtx?.close()
    await talentCtx?.close()
  })

  // (1) auth pages
  for (const path of ['/auth/signin', '/auth/register', '/auth/forgot-password']) {
    test(`auth: ${path}`, async ({ page }) => {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await scan(page, path)
    })
  }

  // (2) dashboards
  for (const path of ['/dashboard', '/videos', '/settings/team']) {
    test(`dashboard (agent): ${path}`, async () => {
      const page = await agentCtx.newPage()
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await scan(page, path)
      await page.close()
    })
  }

  test('dashboard (agent): notification panel open', async () => {
    const page = await agentCtx.newPage()
    await page.goto('/dashboard')
    await page.getByRole('button', { name: /^Notifications/ }).click()
    await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible()
    await scan(page, '/dashboard (notification panel open)')
    await page.close()
  })

  test('dashboard (talent): /dashboard', async () => {
    const page = await talentCtx.newPage()
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await scan(page, '/dashboard (talent)')
    await page.close()
  })

  // (3) video player page
  test('video player page', async () => {
    const page = await agentCtx.newPage()
    await new PlayerPage(page).goto(VIDEO_ID)
    await expect(page.getByRole('textbox', { name: 'Comment', exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await scan(page, `/videos/${VIDEO_ID}`)
    await page.close()
  })

  // (4) comments rail with the comment input focused
  test('comments rail and focused input', async () => {
    const page = await agentCtx.newPage()
    await new PlayerPage(page).goto(VIDEO_ID)
    const input = page.getByRole('textbox', { name: 'Comment', exact: true })
    await expect(input).toBeVisible()
    await page.waitForLoadState('networkidle')
    await input.focus()
    await expect(input).toBeFocused()
    await scan(page, 'comments (input focused)')
    await page.close()
  })

  // (5) guest page
  test('guest page', async ({ page }) => {
    await page.goto(guestPath)
    await page.waitForLoadState('networkidle')
    await scan(page, 'guest')
  })
})
