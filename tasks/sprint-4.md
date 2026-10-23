# Sprint 4 — Accessibility, PWA & Launch Prep

**Status: In Progress**

**Gate:** App is walkable end-to-end for every role: owner sign-up creates an agency, owner invites agent and talent, talent uploads, comment/resolve, approve, guest link. Accessibility audit has zero critical or serious violations; staging smoke suite green; a manual walk of owner, agent, talent and guest completes the core loop. Production validation is post-alpha (S4-LAUNCH-003, not a sprint row).

---

> **Migration numbering (verified 2026-10-22):** migrations 0001–0023 are in the repo. Wave 1 uses **0024–0026** (deletion plan). S4-JOURNEY-001 uses **0027**. Archive & restore (archive plan Phase 5) moves to **0028**. Apply via the `/apply-migration` flow (`sh scripts/db-push.sh local|staging`, `--dry-run` first → both hudo-dev + hudo-staging), never MCP `apply_migration` or the SQL editor. Because 0027 is already applied, pushing 0024–0026 later needs `--include-all` (`db push` refuses versions older than the newest remote one) — check the dry-run list first.

## Tasks

### WAVE 0 — Talent self-serve journey (added 2026-07-05, precedes the planned accessibility/PWA tracks)

---

- [x] **S4-UPLOAD-001** — Talent self-upload

TASK_ID: S4-UPLOAD-001
TITLE: Talent self-upload (camera-roll picker → pending_review + live status)
BRANCH: feat/s4-S4-UPLOAD-001-talent-self-upload
MODEL: sonnet
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Talent role can presign/complete/multipart/thumbnail uploads via new requireUploadRole gate (UPLOAD_ROLES = agent+ AND talent); AGENT_PLUS_ROLES unchanged
  - Anti-impersonation: talent presign forces talentId = self (403 on foreign talentId or non-owned videoId); complete/multipart-url/thumbnail require video.talent_id = caller
  - Talent-completed upload auto-flips draft/changes_requested → pending_review (audit_log status_changed inserted FIRST; flip skipped on audit failure; never regresses pending_review/in_review/approved)
  - enqueueUploadNotification inserts type 'status_changed' rows for agent+ members (excludes uploader, never throws)
  - Pre-existing multipart bug fixed: server accepts partNumber or partNumbers; client reads partUrls[0].url (files >100MB work)
  - Migration 0022 relaxes videos_insert / video_versions_insert for talent self-inserts; pgTAP suites updated with positive + impersonation/cross-agency negative cases
  - Migration 0023 adds videos to supabase_realtime; useRealtimeVideoStatus + VideoStatusLive (debounced router.refresh) mounted on /dashboard, /videos, /talent, /videos/[id]
  - Talent sees plain-text "Submitted for review" after successful upload; talent dashboard CTA to /upload now functional
  - pnpm format:check && pnpm type-check && pnpm lint && pnpm build && pnpm test green; supabase test db tests/rls green
FILES:
  - lib/api-helpers.ts (+ test)
  - lib/notifications.ts (+ test)
  - app/api/videos/upload/presign/route.ts (+ test)
  - app/api/videos/upload/complete/route.ts (+ test)
  - app/api/videos/upload/multipart-url/route.ts (+ new test)
  - app/api/videos/[videoId]/thumbnail/route.ts (+ test)
  - app/(dashboard)/upload/page.tsx
  - app/(dashboard)/dashboard/page.tsx, app/(dashboard)/videos/page.tsx, app/(dashboard)/talent/page.tsx, app/(dashboard)/videos/[id]/page.tsx
  - hooks/useRealtimeVideoStatus.ts (+ test)
  - components/dashboard/VideoStatusLive.tsx
  - supabase/migrations/0022_talent_upload_rls.sql
  - supabase/migrations/0023_videos_realtime_publication.sql
  - tests/rls/videos.test.sql, tests/rls/video_versions.test.sql
  - CLAUDE.md (Realtime stack row)
NOTES: L — Linear RES-199. Storage counts against agency shared quota (talent never separately metered; lib/plans.ts talentLimit: null). No moderation queue — straight into the normal review pipeline. Follow-ups deferred: harden videos_update_talent RLS (pre-existing looseness); email digest for upload notifications (cron batches new_comment only). hudo-prod (paused) needs 0016 + 0022 + 0023 before launch.

---

### WAVE 1 — Deletion, erasure & storage hygiene (added 2026-10-15; plan: `docs/superpowers/plans/2026-10-14-archive-deletion-gdpr.md`, umbrella GitHub #143)

---

- [x] **S4-UPLOADFIX-001** — Upload bugs B1–B3

TASK_ID: S4-UPLOADFIX-001
TITLE: Upload bugs B1-B3 (retry reuses video, real error messages, agent picks talent)
BRANCH: feat/s4-S4-UPLOADFIX-001-upload-bugs
MODEL: sonnet
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - B2: retry reuses the first presign's videoId; no new empty draft per retry
  - B3: presign 402/429 messages pass through; quota panel only for the real "Storage quota exceeded" message; 429 shows the Retry-After wait
  - B1: an agent must pick a talent (roster = talent memberships in the agency) and talentId is sent; talent uploads never send it
  - Tests for each criterion; pnpm format:check && pnpm type-check && pnpm lint && pnpm build && pnpm test green
FILES:
  - lib/upload-client.ts (+ test)
  - lib/talent-roster.ts (+ test)
  - components/upload/UploadProgress.tsx (+ test)
  - app/(dashboard)/upload/page.tsx
NOTES: S — GitHub #149 (B1), #150 (B2), #151 (B3); plan Phase 1. Verify the memberships→users FK name before embedding (Failure Log). Run /live-smoke-test on the Preview URL.

---

- [ ] **S4-DELETE-001** — Delete path foundation

TASK_ID: S4-DELETE-001
TITLE: Delete path foundation (storage_deletions queue, purge functions, R2 prefix delete, daily cron)
BRANCH: feat/s4-S4-DELETE-001-delete-path
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Migration 0024 fixes the three blocking FKs (notifications, guest_links.video_version_id, videos.active_version_id) and adds the storage_deletions queue with RLS
  - Migration 0025 adds purge_video_version / purge_video / purge_talent_in_agency / purge_agency (SECURITY DEFINER, service_role only), each one transaction: queue R2 keys, lower storage_usage_bytes (floor 0), audit_log row, delete rows
  - Purging twice is a no-op; deleting the active version is refused; malformed prefixes are rejected
  - Queue drainer deletes by prefix; an already-gone key counts as done
  - Daily cron /api/cron/storage-purge (CRON_SECRET, 0 3 * * *) drains the queue
  - pgTAP + unit tests for each; reviewers (code, security, RLS) run and logged in SESSIONNOTES.md
FILES:
  - supabase/migrations/0024_storage_deletions_and_cascades.sql
  - supabase/migrations/0025_purge_functions.sql
  - tests/rls/storage_deletions.test.sql, tests/rls/purge_functions.test.sql
  - lib/storage.ts, lib/storage-purge.ts (+ test)
  - app/api/cron/storage-purge/route.ts (+ test)
  - vercel.json, docs/ops/cron-schedule.md
NOTES: L — GitHub #144; plan Phase 2; decision D7. Apply migrations with /apply-migration to BOTH hudo-dev and hudo-staging. Security surface: run hudo-security-reviewer and rls-tenancy-auditor.

---

- [ ] **S4-ERASE-001** — GDPR erasure scoped to one agency

TASK_ID: S4-ERASE-001
TITLE: GDPR erasure (talent videos deleted on erasure, agency-scoped member removal, erasure emails)
BRANCH: feat/s4-S4-ERASE-001-gdpr-erasure
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: S4-DELETE-001
ACCEPTANCE_CRITERIA:
  - Self-erasure permanently deletes the person's videos in every agency they belong to (D12, D13 self); their comments on others' videos keep their text and show "Deleted User"
  - Agency removal deletes the person's videos in that agency only and their membership; account erased only if left in no agency (D13); a talent in two agencies keeps the other
  - Erased person gets a confirmation email; the agency owner gets a receipt; an email failure never fails the erasure (D15)
  - Tests for each criterion; reviewers (code, security, RLS) run and logged
FILES:
  - lib/erasure.ts (+ test)
  - app/api/users/[userId]/data/route.ts (+ test)
  - lib/email-templates/erasure-confirmation.ts, lib/email-templates/member-removed-receipt.ts
NOTES: M — GitHub #145; plan Phase 3. Security surface (app/api/). Needs S4-DELETE-001 merged to main.

---

- [ ] **S4-SAVER-001** — Space savers

TASK_ID: S4-SAVER-001
TITLE: Space savers (R2 multipart-abort lifecycle rule, purge empty drafts)
BRANCH: feat/s4-S4-SAVER-001-space-savers
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: S4-DELETE-001
ACCEPTANCE_CRITERIA:
  - R2 lifecycle rule aborts incomplete multipart uploads after 1 day, documented with the command in docs/r2-setup.md and applied to the dev and staging buckets
  - Migration 0026 + cron step purge empty drafts (no versions) older than 24 hours; tests extended
FILES:
  - docs/r2-setup.md
  - supabase/migrations/0026_purge_empty_drafts.sql
  - tests/rls/purge_functions.test.sql
  - lib/storage-purge.ts (+ test)
NOTES: S — GitHub #146; plan Phase 4; decision D8. The prod bucket needs the same lifecycle rule before launch.

---

### WAVE 2 — Walkable journeys (added 2026-10-22; decisions made with Ian)

---

- [x] **S4-JOURNEY-001** — Minimal agency creation at sign-up

TASK_ID: S4-JOURNEY-001
TITLE: Minimal agency creation at sign-up (agency-name field, atomic RPC, owner lands on /dashboard)
BRANCH: feat/s4-S4-JOURNEY-001-owner-signup
MODEL: sonnet
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Register page has an agency-name field; register route rejects a missing name with 400
  - Migration 0027 adds a service_role-only SECURITY DEFINER RPC create_agency_with_owner that inserts the agency and the owner membership in one transaction
  - Duplicate agency names are handled with a clear error, not a 500
  - Owner lands on /dashboard with an agency (works whether or not email confirmation returns a session)
  - Tests for each criterion; pgTAP for the RPC; pnpm format:check && pnpm type-check && pnpm lint && pnpm build && pnpm test green; supabase test db tests/rls green
FILES:
  - app/auth/register/page.tsx (+ test)
  - app/api/auth/register/route.ts (+ test)
  - supabase/migrations/0027_create_agency_with_owner.sql
  - tests/rls/create_agency_with_owner.test.sql
NOTES: S — Mandatory security review (auth, app/api/) and rls-tenancy-auditor (migration). Use scripts/create-beta-agency.mjs as the reference for agency fields. Archive plan Phase 5 renumbers to 0028.

---

- [x] **S4-JOURNEY-002** — Team page with invite form

TASK_ID: S4-JOURNEY-002
TITLE: Team page with invite form (settings/team, pending list, bounded roles)
BRANCH: feat/s4-S4-JOURNEY-002-team-invites
MODEL: sonnet
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - app/(dashboard)/settings/team exists; the form POSTs /api/invitations/send
  - Role choices are bounded by INVITE_PERMISSIONS (an agent cannot invite an owner)
  - Read-only pending invitations list for the agency
  - Settings nav links to Team
  - Tests for the form and the list; pnpm format:check && pnpm type-check && pnpm lint && pnpm build && pnpm test green
FILES:
  - app/(dashboard)/settings/team/page.tsx (+ test)
  - components/settings/InviteForm.tsx (+ test)
  - app/(dashboard)/settings/layout.tsx or the settings nav component
NOTES: S — Resend and revoke stay in Sprint 5. Reuse requireAgentRole and INVITE_PERMISSIONS from app/api/invitations/send/route.ts. Update docs/flows/inventory.md in the same PR once #175 merges.

---

- [x] **S4-JOURNEY-003** — Invite accept must not burn the token on failure

TASK_ID: S4-JOURNEY-003
TITLE: Invite accept retry (validate before claim, release claim on failure)
BRANCH: feat/s4-S4-JOURNEY-003-accept-retry
MODEL: sonnet
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - A 400 (missing password or name) does not consume the token; the retry with the same token succeeds
  - A createUser 500 releases the claim; the retry succeeds
  - A duplicate-membership 409 releases the claim; the retry succeeds
  - A users-insert failure after createUser does not strand the account (auth user removed or handled on retry)
  - Tests for each criterion; pnpm format:check && pnpm type-check && pnpm lint && pnpm build && pnpm test green
FILES:
  - app/api/invitations/accept/route.ts (+ route.test.ts)
NOTES: S — Security surface (app/api/, invitations). Mandatory hudo-security-reviewer.

---

- [ ] **S4-JOURNEY-004** — Load the middleware

TASK_ID: S4-JOURNEY-004
TITLE: Move middleware to project root and open only the public paths
BRANCH: feat/s4-S4-JOURNEY-004-middleware
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: S4-JOURNEY-001, S4-JOURNEY-002, S4-JOURNEY-003
ACCEPTANCE_CRITERIA:
  - middleware.ts lives at the project root (app/middleware.ts removed); Next 14 loads it
  - Signed-out requests to protected pages redirect to sign-in
  - /api/webhooks/*, /api/cron/*, /guest/*, public auth pages and static assets are not redirected
  - Role gating runs for the first time; tests cover the matcher and the redirect rules
  - Live check on a Preview URL before merge (signed-out redirect; guest, webhook and cron reachable)
FILES:
  - middleware.ts (new, moved from app/middleware.ts)
  - app/middleware.ts (deleted)
  - middleware.test.ts
NOTES: S — Security surface (auth). Mandatory hudo-security-reviewer. Runs alone after 001–003 merge.

---

- [ ] **S4-LAUNCH-001** — Legal pages

TASK_ID: S4-LAUNCH-001
TITLE: Terms, privacy and DPA pages with shared footer and links
BRANCH: feat/s4-S4-LAUNCH-001-legal-pages
MODEL: haiku
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - /terms, /privacy and /dpa are public routes (listed in the middleware public paths)
  - Shared footer on those pages; links from register and the cookie banner
  - Copy is drafted by the agent from components/billing/DpaAcceptanceModal.tsx and the subprocessor list (Supabase, Cloudflare, Vercel, Stripe, Resend, Upstash, Sentry, PostHog); marked DRAFT until Ian approves
  - Tests for routes and links; pnpm format:check && pnpm type-check && pnpm lint && pnpm build && pnpm test green
FILES:
  - app/(public)/terms/page.tsx, app/(public)/privacy/page.tsx, app/(public)/dpa/page.tsx (+ tests)
  - components/layout/LegalFooter.tsx (+ test)
  - app/auth/register/page.tsx, the cookie banner component
NOTES: S — Ian reviews the copy before any customer sees it. Human-only: legal review.

---

- [ ] **S4-LAUNCH-004** — Onboarding checklist

TASK_ID: S4-LAUNCH-004
TITLE: Owner onboarding checklist (invite agent, invite talent, upload), derived from data
BRANCH: feat/s4-S4-LAUNCH-004-onboarding-checklist
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: S4-JOURNEY-001, S4-JOURNEY-002
ACCEPTANCE_CRITERIA:
  - Owner-only checklist on /dashboard with three items: invite agent, invite talent, upload a video
  - Completion is derived from memberships, invitations and videos (no new table, no migration)
  - Hidden once all three are done; non-owners never see it
  - Tests for derivation and visibility; pnpm format:check && pnpm type-check && pnpm lint && pnpm build && pnpm test green
FILES:
  - components/dashboard/OnboardingChecklist.tsx (+ test)
  - lib/onboarding-checklist.ts (+ test)
  - app/(dashboard)/dashboard/page.tsx
NOTES: S — Reads data via lib/dashboard.ts patterns; any videos↔video_versions embed must name the FK (Failure Log).

---

- [ ] **S4-PWA-001** — PWA manifest, icons and service worker

TASK_ID: S4-PWA-001
TITLE: PWA manifest, icons, offline page and shell-only service worker
BRANCH: feat/s4-S4-PWA-001-pwa
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: S4-JOURNEY-004
ACCEPTANCE_CRITERIA:
  - app/manifest.ts and public/ icons exist; placeholder icons until Ian supplies brand icons
  - Service worker caches only the app shell and static assets; never HTML behind login, API responses or signed R2 URLs
  - /offline page renders without auth
  - Tests for the cache allowlist and the manifest; pnpm format:check && pnpm type-check && pnpm lint && pnpm build && pnpm test green
FILES:
  - app/manifest.ts, public/icons/*, public/sw.js
  - app/offline/page.tsx
  - lib/pwa-cache-rules.ts (+ test)
NOTES: S — Human-only: brand icons, install check on a real iOS and Android device.

---

- [ ] **S4-ACCESS-001** — axe audit over five page groups

TASK_ID: S4-ACCESS-001
TITLE: Automated WCAG 2.1 AA audit (axe) and fixes
BRANCH: feat/s4-S4-ACCESS-001-axe
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: S4-JOURNEY-004, S4-DELETE-001, S4-ERASE-001, S4-SAVER-001
ACCEPTANCE_CRITERIA:
  - @axe-core/playwright added (flagged in PR for dependency approval)
  - tests/e2e/a11y.spec.ts scans five page groups: auth, dashboard, video player, comments, guest
  - Zero critical or serious violations after fixes
  - pnpm format:check && pnpm type-check && pnpm lint && pnpm build && pnpm test green
FILES:
  - tests/e2e/a11y.spec.ts
  - package.json, pnpm-lock.yaml
  - components/** (fixes as needed)
NOTES: M — Runs after Waves B–C so fixes do not collide with UI changes. Adding a dependency needs flagging first (CLAUDE.md).

---

- [ ] **S4-ACCESS-002** — Screen reader testing

TASK_ID: S4-ACCESS-002
TITLE: Manual VoiceOver and NVDA pass
BRANCH: —
MODEL: human
STATUS: not_started
BLOCKED_BY: S4-ACCESS-001
ACCEPTANCE_CRITERIA:
  - NVDA (Windows) and VoiceOver (macOS/iOS) walk of the core loop; findings filed as issues
NOTES: Human-only. Needs Ian or a tester with NVDA.

---

- [ ] **S4-LAUNCH-002** — Staging smoke suite

TASK_ID: S4-LAUNCH-002
TITLE: Seven-flow smoke suite against staging (register, invite, upload, comment, PDF, guest, upgrade)
BRANCH: feat/s4-S4-LAUNCH-002-smoke
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: S4-JOURNEY-004, S4-LAUNCH-004
ACCEPTANCE_CRITERIA:
  - Seven flows: register → agency; invite talent → accept; upload; comment and resolve; PDF export; guest link; upgrade in Stripe test mode
  - tests/e2e/ extended using existing page objects and fixtures
  - Workflow fails (not skips) when PLAYWRIGHT_TEST_URL is unset; waits for the Vercel deployment
  - Cleanup fixture removes test agency data
  - pnpm format:check && pnpm type-check && pnpm lint && pnpm build && pnpm test green
FILES:
  - tests/e2e/smoke/*.spec.ts
  - .github/workflows/smoke.yml
NOTES: M — Human-only: staging Stripe test webhook. Human-only: confirm the Supabase "confirm email" setting on staging.

---

> Archive & restore (archive plan Phase 5) and agency closure (Phase 6) are post-launch and are not sprint rows yet.
> **S4-LAUNCH-003 (production validation) moved out of Sprint 4** to a post-alpha step. Checklist for that time: unpause hudo-prod, apply 0001–0027, live Stripe catalogue and webhook, R2 CORS `ExposeHeaders: ETag` with exact origin, r2.dev sign-off, Resend domain, Upstash prod, Sentry/PostHog, branch protection.
