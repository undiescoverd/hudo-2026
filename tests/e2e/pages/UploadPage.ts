import { Page } from '@playwright/test';

// Page Object for the upload flow — populated in S1-E2E-001
//
// Expected data-testid selectors:
//   upload-zone         — drag-and-drop / file input area
//   upload-progress     — progress bar shown during upload
//   upload-error        — error message shown on invalid file type
//   video-status        — badge/text showing current video status (e.g. "ready")

export class UploadPage {
  constructor(readonly page: Page) {}
}
