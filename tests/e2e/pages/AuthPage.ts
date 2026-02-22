import type { Page } from '@playwright/test'

// Page Object for /auth/signin and /auth/register — populated in S1-E2E-001
//
// Expected data-testid selectors:
//   sign-in-email       — email input on sign-in form
//   sign-in-password    — password input on sign-in form
//   sign-in-submit      — submit button on sign-in form
//   sign-up-email       — email input on sign-up form
//   sign-up-password    — password input on sign-up form
//   sign-up-submit      — submit button on sign-up form
//   sign-out-button     — sign-out trigger in nav/header
//   auth-error-message  — inline error displayed on auth failure

export class AuthPage {
  constructor(readonly page: Page) {}
}
