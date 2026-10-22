# Sprint 4 — Accessibility, PWA & Launch Prep

**Status: In Progress**

**Gate:** App is walkable end-to-end for every role including talent self-serve upload. Accessibility, PWA, and launch-prep tasks land per sprints-all.md; every sprint ships at least one complete user journey.

---

> **Migration numbering (verified 2026-07-05):** existing migrations run 0001–0021. This sprint starts at **0022** (talent-upload RLS) and **0023** (videos realtime publication). Apply via the `/apply-migration` flow (MCP `apply_migration` → both hudo-dev + hudo-staging), never the SQL editor.

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

- [ ] **S4-UPLOADFIX-001** — Upload bugs B1–B3

TASK_ID: S4-UPLOADFIX-001
TITLE: Upload bugs B1-B3 (retry reuses video, real error messages, agent picks talent)
BRANCH: feat/s4-S4-UPLOADFIX-001-upload-bugs
MODEL: sonnet
STATUS: in_review
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

> Archive & restore (plan Phase 5, GitHub #147) and agency closure (Phase 6, #148) are post-launch and are not sprint rows yet. Remaining S4 tasks (S4-ACCESS-001/002, S4-PWA-001, S4-LAUNCH-001..004) to be broken out from tasks/sprints-all.md when this wave closes.
