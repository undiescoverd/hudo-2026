/**
 * S0-AUTH-003 — Sign-in and sign-out flow acceptance criteria tests
 *
 * Criteria verified:
 * 1. Sign-in page renders email and password fields
 * 2. Empty submit shows field-level errors
 * 3. Invalid credentials show server error
 * 4. Successful sign-in redirects to / (or redirect param)
 * 5. Sign-out clears session and redirects to /auth/signin
 * 6. /auth/signin is publicly accessible (no redirect loop)
 */

import { test, expect } from '@playwright/test'

const TEST_AGENCY_EMAIL = process.env.E2E_TEST_AGENCY_EMAIL || 'test@agency.local'
const TEST_AGENCY_PASSWORD = process.env.E2E_TEST_AGENCY_PASSWORD || 'TestPass1'

test.describe('S0-AUTH-003: Sign-in and sign-out flow', () => {
  test('allows unauthenticated access to /auth/signin', async ({ page }) => {
    // Criteria: sign-in page is public (no auth required)
    const response = await page.goto('/auth/signin')
    await expect(page).toHaveURL(/\/auth\/signin/)
    expect(response?.status()).toBeLessThan(500)
  })

  test('renders sign-in form with email and password fields', async ({ page }) => {
    // Criteria: page accepts email and password
    await page.goto('/auth/signin')
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('shows field-level errors on empty submit', async ({ page }) => {
    // Criteria: invalid inputs show field-level errors
    await page.goto('/auth/signin')
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByText('Email is required')).toBeVisible()
    await expect(page.getByText('Password is required')).toBeVisible()
  })

  test('shows field error for invalid email format', async ({ page }) => {
    // Criteria: email validation
    await page.goto('/auth/signin')
    await page.getByLabel('Email').fill('not-an-email')
    await page.getByLabel('Password').fill('ValidPass1')
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByText('Please enter a valid email address')).toBeVisible()
  })

  test('shows server error for invalid credentials', async ({ page }) => {
    // Criteria: invalid credentials show user-facing server error
    await page.goto('/auth/signin')
    await page.getByLabel('Email').fill('nonexistent@test.local')
    await page.getByLabel('Password').fill('WrongPass1')
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByRole('alert')).toContainText('Invalid email or password')
  })

  test('successful sign-in redirects to home page', async ({ page }) => {
    // Criteria: successful sign-in redirects to / (requires seeded test user)
    await page.goto('/auth/signin')
    await page.getByLabel('Email').fill(TEST_AGENCY_EMAIL)
    await page.getByLabel('Password').fill(TEST_AGENCY_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    // Should redirect to home after successful sign-in
    await expect(page).toHaveURL('/')
  })

  test('successful sign-in with redirect parameter navigates to provided path', async ({
    page,
  }) => {
    // Criteria: sign-in respects redirect query param (safe-redirect)
    await page.goto('/auth/signin?redirect=/dashboard')
    await page.getByLabel('Email').fill(TEST_AGENCY_EMAIL)
    await page.getByLabel('Password').fill(TEST_AGENCY_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    // Should redirect to /dashboard (from redirect param)
    await expect(page).toHaveURL('/dashboard')
  })

  test('sign-out clears session and redirects to sign-in page', async ({ page }) => {
    // Criteria: sign-out clears session and redirects to /auth/signin
    // First, sign in
    await page.goto('/auth/signin')
    await page.getByLabel('Email').fill(TEST_AGENCY_EMAIL)
    await page.getByLabel('Password').fill(TEST_AGENCY_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page).toHaveURL('/')

    // Now sign out via API (since there's no UI button in the current implementation)
    // We test the redirect behavior
    const signoutResponse = await page.request.post('/api/auth/signout')
    // Check that it redirects (3xx response)
    expect(signoutResponse.status()).toBeGreaterThanOrEqual(300)
    expect(signoutResponse.status()).toBeLessThan(400)

    // After signout, navigate to protected route should redirect to signin
    await page.goto('/')
    await expect(page).toHaveURL(/\/auth\/signin/)
  })
})
