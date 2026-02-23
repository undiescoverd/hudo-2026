/**
 * S0-AUTH-006 — Role-based middleware acceptance criteria tests
 *
 * Criteria verified:
 * 1. /admin routes require owner or admin_agent role (others get 403)
 * 2. /agent routes require owner, admin_agent, or agent role (talent gets 403)
 * 3. /talent routes are accessible to talent role (and higher)
 * 4. /guest/* paths bypass auth middleware entirely (no redirect to sign-in)
 * 5. Unauthenticated access to role-restricted routes redirects to /sign-in
 *
 * NOTE: Tests that require authenticated sessions with specific roles rely on
 * seeded test users (E2E_TEST_* environment variables). Tests that do not
 * require login verify the unauthenticated-path behaviour only.
 *
 * Full authenticated role tests will be wired up in S1-E2E-001 when the
 * authenticated fixture is populated.
 */

import { test, expect } from '@playwright/test'

test.describe('S0-AUTH-006: Role-based middleware — unauthenticated behaviour', () => {
  test('unauthenticated access to /admin redirects to /sign-in', async ({ page }) => {
    // Criteria: /admin routes require authentication (and role)
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('unauthenticated access to /admin/settings redirects to /sign-in', async ({ page }) => {
    // Criteria: /admin/* sub-paths also require authentication
    await page.goto('/admin/settings')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('unauthenticated access to /agent redirects to /sign-in', async ({ page }) => {
    // Criteria: /agent routes require authentication (and role)
    await page.goto('/agent')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('unauthenticated access to /agent/dashboard redirects to /sign-in', async ({ page }) => {
    // Criteria: /agent/* sub-paths also require authentication
    await page.goto('/agent/dashboard')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('unauthenticated access to /talent redirects to /sign-in', async ({ page }) => {
    // Criteria: /talent routes require authentication (and role)
    await page.goto('/talent')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('unauthenticated access to /talent/videos redirects to /sign-in', async ({ page }) => {
    // Criteria: /talent/* sub-paths also require authentication
    await page.goto('/talent/videos')
    await expect(page).toHaveURL(/\/sign-in/)
  })
})

test.describe('S0-AUTH-006: Role-based middleware — guest path bypass', () => {
  test('/guest path does not redirect to sign-in', async ({ page }) => {
    // Criteria: guest paths bypass auth middleware entirely
    // The page may 404 or render an error (no guest page exists yet),
    // but it must NOT redirect to /sign-in.
    const response = await page.goto('/guest')
    // Must not have been redirected to /sign-in
    expect(page.url()).not.toContain('/sign-in')
    // Server error is acceptable (page not implemented yet), but not auth redirect
    if (response) {
      expect(response.status()).not.toBe(302)
    }
  })

  test('/guest/some-token does not redirect to sign-in', async ({ page }) => {
    // Criteria: /guest/* sub-paths bypass auth middleware
    const response = await page.goto('/guest/test-token-abc123')
    expect(page.url()).not.toContain('/sign-in')
    if (response) {
      expect(response.status()).not.toBe(302)
    }
  })
})

test.describe('S0-AUTH-006: Role-based middleware — public paths unaffected', () => {
  test('/sign-in is still publicly accessible', async ({ page }) => {
    // Regression: adding /guest to PUBLIC_PATHS must not break other public paths
    const response = await page.goto('/sign-in')
    await expect(page).toHaveURL(/\/sign-in/)
    expect(response?.status()).toBeLessThan(500)
  })

  test('/sign-up is still publicly accessible', async ({ page }) => {
    const response = await page.goto('/sign-up')
    await expect(page).toHaveURL(/\/sign-up/)
    expect(response?.status()).toBeLessThan(500)
  })

  test('/auth/register is still publicly accessible', async ({ page }) => {
    const response = await page.goto('/auth/register')
    // Must not redirect to /sign-in
    expect(page.url()).not.toMatch(/\/sign-in/)
    expect(response?.status()).toBeLessThan(500)
  })

  test('/auth/invite is still publicly accessible', async ({ page }) => {
    const response = await page.goto('/auth/invite')
    expect(page.url()).not.toMatch(/\/sign-in/)
    expect(response?.status()).toBeLessThan(500)
  })
})
