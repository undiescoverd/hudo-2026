import { test as base, expect, type Page } from '@playwright/test'

const TEST_EMAIL = process.env.E2E_TEST_AGENCY_EMAIL
const TEST_PASSWORD = process.env.E2E_TEST_AGENCY_PASSWORD

if (!TEST_EMAIL) {
  throw new Error('E2E_TEST_AGENCY_EMAIL environment variable is required for E2E tests')
}
if (!TEST_PASSWORD) {
  throw new Error('E2E_TEST_AGENCY_PASSWORD environment variable is required for E2E tests')
}

/**
 * Signs in via the UI and returns the authenticated page.
 */
async function signIn(page: Page): Promise<void> {
  await page.goto('/auth/signin')
  await page.getByLabel('Email').fill(TEST_EMAIL!)
  await page.getByLabel('Password').fill(TEST_PASSWORD!)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL('/')
}

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    await signIn(page)
    await use(page)
  },
})

export { expect } from '@playwright/test'
