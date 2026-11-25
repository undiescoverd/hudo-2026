import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

// Page Object for /guest/:token.
//
// Guests see the video only: no comments (S5-GUEST-001, GH #165).

export class GuestPage {
  constructor(readonly page: Page) {}

  async openAndExpectVideoOnly(url: string, commentText: string) {
    await this.page.goto(url)
    await expect(this.page).toHaveURL(/\/guest\/[A-Za-z0-9_-]{43}/)
    await expect(this.page.locator('video')).toBeVisible({ timeout: 30_000 })
    await expect(this.page.getByText(commentText)).toHaveCount(0)
  }
}
