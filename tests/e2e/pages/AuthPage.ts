import { expect, type Page } from '@playwright/test'

// Page Object for /auth/signin, /auth/register and /auth/invite/:token.
// The app has no data-testid hooks on these screens, so locators are label/role based.
//
// Originally-planned data-testid selectors (not implemented in the app, kept for reference):
//   sign-in-email, sign-in-password, sign-in-submit, sign-up-email, sign-up-password,
//   sign-up-submit, sign-out-button, auth-error-message

export class AuthPage {
  constructor(readonly page: Page) {}

  /** Fills and submits the owner sign-up form (S4-LAUNCH-002 flow 1). */
  async register(opts: { fullName: string; agencyName: string; email: string; password: string }) {
    await this.page.goto('/auth/register')
    await this.page.getByLabel('Full name').fill(opts.fullName)
    await this.page.getByLabel('Agency name').fill(opts.agencyName)
    await this.page.getByLabel('Email').fill(opts.email)
    await this.page.getByLabel('Password').fill(opts.password)
    await this.page.getByRole('button', { name: /create account/i }).click()
  }

  /** Signs in through the UI and waits to leave /auth/*. */
  async signIn(email: string, password: string) {
    await this.page.goto('/auth/signin')
    await this.page.getByLabel('Email').fill(email)
    await this.page.getByLabel('Password').fill(password)
    await this.page.getByRole('button', { name: /sign in/i }).click()
    await this.page.waitForURL((u) => !u.pathname.startsWith('/auth/'), { timeout: 20_000 })
  }

  /** Accepts an invitation as a new user on /auth/invite/:token. */
  async acceptInviteAsNewUser(token: string, fullName: string, password: string) {
    await this.page.goto(`/auth/invite/${token}`)
    await expect(this.page.getByRole('heading', { name: 'Create your account' })).toBeVisible({
      timeout: 15_000,
    })
    await this.page.getByLabel('Full name').fill(fullName)
    await this.page.getByLabel('Password').fill(password)
    await this.page.getByRole('button', { name: /create account & join/i }).click()
    await expect(this.page.getByRole('heading', { name: 'Welcome aboard!' })).toBeVisible({
      timeout: 20_000,
    })
  }
}
