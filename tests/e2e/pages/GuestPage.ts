import { Page } from '@playwright/test';

// Page Object for /guest/:token — populated in S2-E2E-001
//
// Expected data-testid selectors:
//   guest-player          — <video> element on the guest view
//   comment-panel         — read-only comment list shown to guest
//   guest-expired-message — message displayed when token is invalid/expired

export class GuestPage {
  constructor(readonly page: Page) {}
}
