import { expect, Page } from '@playwright/test'

// Page Object for /guest/:token.
//
// Originally-planned data-testid selectors (not implemented in the app, kept for reference):
//   guest-player, comment-panel, guest-expired-message

export class GuestPage {
  constructor(readonly page: Page) {}

  async openAndExpectComment(url: string, commentText: string) {
    await this.page.goto(url)
    await expect(this.page).toHaveURL(/\/guest\/[A-Za-z0-9_-]{43}/)
    await expect(this.page.getByText(commentText)).toBeVisible({ timeout: 30_000 })
  }
}
