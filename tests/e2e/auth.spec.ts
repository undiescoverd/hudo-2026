/**
 * S0-AUTH-001 — Supabase Auth acceptance criteria tests
 *
 * Criteria verified:
 * 1. Supabase Auth client initialised in app (lib/auth.ts exports createClient)
 * 2. Session management configured and tested (getSession / getUser helpers)
 * 3. Auth state persists across page reloads (middleware refreshes cookie on every request)
 * 4. Unauthenticated users redirected to /sign-in (middleware redirect)
 *
 * These are E2E tests that verify the middleware redirect behaviour.
 * Unit tests for lib/auth.ts helpers are in lib/auth.test.ts.
 */

import { test, expect } from '@playwright/test'

test.describe('S0-AUTH-001: Auth middleware — unauthenticated redirect', () => {
  test('redirects unauthenticated users from / to /sign-in', async ({ page }) => {
    // Criteria: Unauthenticated users redirected to sign-in page
    await page.goto('/')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('redirects unauthenticated users from a protected path to /sign-in', async ({ page }) => {
    // Criteria: Any protected route requires authentication
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('allows unauthenticated access to /sign-in without redirect loop', async ({ page }) => {
    // Criteria: Sign-in page itself is publicly accessible
    const response = await page.goto('/sign-in')
    // Must not redirect away from /sign-in (would cause infinite loop)
    await expect(page).toHaveURL(/\/sign-in/)
    // Must not be a server error
    expect(response?.status()).toBeLessThan(500)
  })

  test('allows unauthenticated access to /sign-up without redirect', async ({ page }) => {
    // Criteria: Sign-up page is publicly accessible
    const response = await page.goto('/sign-up')
    await expect(page).toHaveURL(/\/sign-up/)
    expect(response?.status()).toBeLessThan(500)
  })
})
