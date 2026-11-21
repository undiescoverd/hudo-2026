import { defineConfig, devices } from '@playwright/test'

/**
 * Config for the seven-flow staging smoke suite (S4-LAUNCH-002).
 * Run with: pnpm exec playwright test -c tests/e2e/smoke/playwright.smoke.config.ts
 *
 * Separate from the root config so `pnpm test:e2e` never runs these (they create real data).
 * PLAYWRIGHT_TEST_URL is mandatory: the suite fails, it never skips, without it.
 */
const baseURL = process.env.PLAYWRIGHT_TEST_URL
if (!baseURL) {
  throw new Error('PLAYWRIGHT_TEST_URL is not set: the smoke suite needs a deployed staging URL')
}

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  // The seven flows share one agency and run in order on one worker.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['html', { outputFolder: 'playwright-report' }], ['github']] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
