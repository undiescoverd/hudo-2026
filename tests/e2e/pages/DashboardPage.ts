import { Page } from '@playwright/test'

// Page Object for /dashboard — populated in S1-E2E-001 and S3-E2E-001
//
// Expected data-testid selectors:
//   dashboard-video-list  — container element holding all video cards
//   video-card-title      — title text within an individual video card
//   upgrade-button        — CTA to open Stripe checkout (used in S3-E2E-001)

export class DashboardPage {
  constructor(readonly page: Page) {}
}
