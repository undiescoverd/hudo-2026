/**
 * S0-AUTH-001 — Supabase Auth acceptance criteria tests
 *
 * Criteria verified:
 * 1. Supabase Auth client initialised in app (lib/auth.ts exports createClient)
 * 2. Session management configured and tested (getSession / getUser helpers)
 * 3. Auth state persists across page reloads (middleware refreshes cookie on every request)
 * 4. Unauthenticated users redirected to /auth/signin (middleware redirect)
 *
 * These are E2E tests that verify the middleware redirect behaviour.
 * Unit tests for lib/auth.ts helpers are in lib/auth.test.ts.
 */

import { test, expect } from '@playwright/test'

test.describe('S0-AUTH-001: Auth middleware — unauthenticated redirect', () => {
  test('redirects unauthenticated users from / to /auth/signin', async ({ page }) => {
    // Criteria: Unauthenticated users redirected to sign-in page
    await page.goto('/')
    await expect(page).toHaveURL(/\/auth\/signin/)
  })

  test('redirects unauthenticated users from a protected path to /auth/signin', async ({
    page,
  }) => {
    // Criteria: Any protected route requires authentication
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/auth\/signin/)
  })

  test('allows unauthenticated access to /auth/signin without redirect loop', async ({ page }) => {
    // Criteria: Sign-in page itself is publicly accessible
    const response = await page.goto('/auth/signin')
    // Must not redirect away from /auth/signin (would cause infinite loop)
    await expect(page).toHaveURL(/\/auth\/signin/)
    // Must not be a server error
    expect(response?.status()).toBeLessThan(500)
  })

  test('allows unauthenticated access to /auth/register without redirect', async ({ page }) => {
    // Criteria: Registration page is publicly accessible
    const response = await page.goto('/auth/register')
    await expect(page).toHaveURL(/\/auth\/register/)
    expect(response?.status()).toBeLessThan(500)
  })
})
