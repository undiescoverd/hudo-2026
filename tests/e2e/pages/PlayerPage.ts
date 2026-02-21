import { Page } from '@playwright/test'

// Page Object for the video player view — populated in S1-E2E-001
//
// Expected data-testid selectors:
//   video-player        — <video> element (used to read currentTime)
//   comment-panel       — the comment list sidebar/panel
//   comment-timestamp   — clickable timestamp link within a comment
//   comment-input       — text input for writing a new comment
//   comment-submit      — submit button for new comment

export class PlayerPage {
  constructor(readonly page: Page) {}
}
