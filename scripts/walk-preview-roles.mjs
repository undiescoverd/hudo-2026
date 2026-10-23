// Live role walk of a Vercel Preview URL (staging data): signs in as each seeded
// role, visits the main pages, creates a 1-hour guest link as owner and opens it
// signed out. Used as the S4-JOURNEY-004 merge check (middleware runs live).
//
// Usage:
//   node --env-file=.env.staging scripts/walk-preview-roles.mjs <preview-url> [role ...]
// Roles default to owner agent talent (the seed-staging.mjs users, <role>@hudo.test).
// Reads STAGING_SEED_PASSWORD from the environment and never prints it.
// Side effect: one guest link (1h expiry) on the seed video in hudo-staging.
import { chromium } from '@playwright/test'

const [BASE, ...argRoles] = process.argv.slice(2)
const ROLES = argRoles.length ? argRoles : ['owner', 'agent', 'talent']
const PASSWORD = process.env.STAGING_SEED_PASSWORD
const SEED_VIDEO = '7cb31754-187e-4f68-9a76-6a3a1973e080'
if (!BASE || !PASSWORD) {
  throw new Error('usage: walk-preview-roles.mjs <preview-url> [role ...] (STAGING_SEED_PASSWORD in env)')
}

const PAGES = [
  '/',
  '/dashboard',
  '/talent',
  '/videos',
  `/videos/${SEED_VIDEO}`,
  '/upload',
  '/settings/notifications',
  '/settings/team',
  '/settings/billing',
]

const browser = await chromium.launch()
let guestUrl = null

async function visit(page, path) {
  try {
    const res = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const url = new URL(page.url())
    const body = (await page.textContent('body').catch(() => '')) ?? ''
    const flags = []
    if (/^\s*Forbidden\s*$/.test(body)) flags.push('FORBIDDEN-PAGE')
    if (/Unable to load|Something went wrong|Application error/i.test(body)) flags.push('ERROR-TEXT')
    return `${res?.status() ?? '???'} -> ${url.pathname}${url.search}${flags.length ? '  [' + flags.join(',') + ']' : ''}`
  } catch (e) {
    // ERR_TOO_MANY_REDIRECTS here means a redirect loop.
    return `THREW ${e.message.split('\n')[0]}`
  }
}

for (const role of ROLES) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 120)))

  // Sign-in round trip from a protected deep link.
  await page.goto(BASE + '/auth/signin?redirect=%2Fsettings%2Fnotifications')
  await page.fill('#email', `${role}@hudo.test`)
  await page.fill('#password', PASSWORD)
  await page.click('button[type="submit"]')
  let landed
  try {
    await page.waitForURL((u) => !u.pathname.startsWith('/auth/signin'), { timeout: 25000 })
    landed = new URL(page.url()).pathname
  } catch {
    const form = ((await page.textContent('form').catch(() => '')) ?? '').slice(0, 120)
    landed = `STUCK on ${new URL(page.url()).pathname} :: ${form}`
  }
  console.log(`\n== ${role} ==\nsign-in round trip (redirect=/settings/notifications) -> ${landed}`)
  if (landed.startsWith('STUCK')) {
    await ctx.close()
    continue
  }

  for (const p of PAGES) console.log(`  ${p.padEnd(52)} ${await visit(page, p)}`)

  if (role === 'owner') {
    const r = await page.evaluate(
      async ({ base, vid }) => {
        const res = await fetch(`${base}/api/videos/${vid}/guest-links`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expires_at: new Date(Date.now() + 3600e3).toISOString() }),
        })
        const j = await res.json().catch(() => ({}))
        return { status: res.status, url: j.url ?? null, error: j.error ?? null }
      },
      { base: BASE, vid: SEED_VIDEO }
    )
    console.log(`  guest link create -> ${r.status} ${r.error ?? ''}`)
    if (r.url) guestUrl = BASE + new URL(r.url).pathname
  }
  const uniq = [...new Set(consoleErrors)]
  if (uniq.length) console.log(`  console errors (${uniq.length}):\n    ` + uniq.slice(0, 6).join('\n    '))
  await ctx.close()
}

console.log('\n== guest (no session) ==')
if (guestUrl) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const res = await page.goto(guestUrl, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => e)
  const path = new URL(page.url()).pathname
  const hasVideo = (await page.locator('video').count()) > 0
  const ready = hasVideo
    ? await page.locator('video').first().evaluate((v) => v.readyState).catch(() => 'n/a')
    : 'n/a'
  const shown = path.startsWith('/guest/') && path !== '/guest/invalid' ? '/guest/<token>' : path
  console.log(`  guest page -> ${res?.status?.() ?? res} ${shown}  video=${hasVideo} readyState=${ready}`)
  await ctx.close()
} else {
  console.log('  skipped: no guest link created (owner walk failed?)')
}

await browser.close()
