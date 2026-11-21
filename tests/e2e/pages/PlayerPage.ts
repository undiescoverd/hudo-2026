import { expect, Page } from '@playwright/test'

// Page Object for the authenticated video page /videos/:id.
//
// Originally-planned data-testid selectors (not implemented in the app, kept for reference):
//   video-player, comment-panel, comment-timestamp, comment-input, comment-submit

export class PlayerPage {
  constructor(readonly page: Page) {}

  async goto(videoId: string) {
    await this.page.goto(`/videos/${videoId}`)
  }

  async postComment(text: string) {
    const input = this.page.getByRole('textbox', { name: 'Comment', exact: true })
    await input.fill(text)
    await this.page.getByRole('button', { name: 'Post', exact: true }).click()
    await expect(this.page.getByText(text)).toBeVisible({ timeout: 20_000 })
  }

  async resolveFirstComment() {
    await this.page
      .getByRole('button', { name: /^Resolve comment by/ })
      .first()
      .click()
    await expect(
      this.page.getByRole('button', { name: /^Unresolve comment by/ }).first()
    ).toBeVisible({
      timeout: 20_000,
    })
  }

  /** Opens Share, generates a guest link and returns its URL (shown once, in a read-only input). */
  async createGuestLink(): Promise<string> {
    await this.page.getByRole('button', { name: 'Share', exact: true }).click()
    await this.page.getByRole('button', { name: '+ Generate link' }).click()
    await this.page.getByRole('button', { name: 'Generate link', exact: true }).click()
    await expect(this.page.getByRole('heading', { name: 'Guest Link Created' })).toBeVisible({
      timeout: 20_000,
    })
    const url = await this.page.locator('input[readonly]').first().inputValue()
    expect(url).toMatch(/\/guest\/[A-Za-z0-9_-]{43}/)
    return url
  }
}
