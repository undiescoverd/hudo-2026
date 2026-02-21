import { test as base } from '@playwright/test'

// Authenticated session fixture — populated in S1-E2E-001
// Signs in with E2E_TEST_AGENCY_EMAIL / E2E_TEST_AGENCY_PASSWORD and stores session state.

export const test = base.extend({
  // authenticatedPage will be wired up in S1-E2E-001
})

export { expect } from '@playwright/test'
