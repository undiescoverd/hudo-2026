import { test as base } from '@playwright/test';

// Guest session fixture — populated in S2-E2E-001
// Navigates to /guest/:token using E2E_GUEST_TEST_TOKEN from environment.

export const test = base.extend({
  // guestPage will be wired up in S2-E2E-001
});

export { expect } from '@playwright/test';
