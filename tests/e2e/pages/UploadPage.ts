import { expect, Page } from '@playwright/test'

// Page Object for the upload flow at /upload.
//
// Originally-planned data-testid selectors (not implemented in the app, kept for reference):
//   upload-zone, upload-progress, upload-error, video-status

export class UploadPage {
  constructor(readonly page: Page) {}

  /**
   * Uploads a file as an agent-class user (who must pick a talent), titles it and returns
   * the new video id parsed from the /videos/:id redirect.
   */
  async uploadForTalent(file: { name: string; mimeType: string; buffer: Buffer }, title: string) {
    await this.page.goto('/upload')
    const talent = this.page.locator('#upload-talent')
    await expect(talent).toBeVisible({ timeout: 20_000 })
    // option 0 is the "Select a talent…" placeholder; the invited talent is the first real one.
    await expect(talent.locator('option')).toHaveCount(2, { timeout: 20_000 })
    await talent.selectOption({ index: 1 })
    await this.page.getByLabel('Select video file').setInputFiles(file)
    await expect(this.page.getByText('Upload complete')).toBeVisible({ timeout: 90_000 })
    await this.page.locator('#metadata-title').fill(title)
    await this.page.getByRole('button', { name: 'Save & continue' }).click()
    await this.page.waitForURL(/\/videos\/[0-9a-f-]{36}/, { timeout: 30_000 })
    return /\/videos\/([0-9a-f-]{36})/.exec(this.page.url())![1]
  }
}
