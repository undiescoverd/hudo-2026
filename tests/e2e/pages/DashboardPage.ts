import { expect, Page } from '@playwright/test'

// Page Object for /dashboard, /settings/team and /settings/billing.
//
// Originally-planned data-testid selectors (not implemented in the app, kept for reference):
//   dashboard-video-list, video-card-title, upgrade-button

export class DashboardPage {
  constructor(readonly page: Page) {}

  /** Sends an invitation from /settings/team via the InviteForm. */
  async inviteMember(email: string, role: 'talent' | 'agent' | 'admin_agent') {
    await this.page.goto('/settings/team')
    await this.page.locator('#invite-email').fill(email)
    await this.page.locator('#invite-role').selectOption(role)
    await this.page.getByRole('button', { name: 'Send invitation' }).click()
    await expect(this.page.getByText(`Invitation sent to ${email}`)).toBeVisible({
      timeout: 20_000,
    })
  }
}
