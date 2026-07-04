# Sprint 4 — Accessibility, PWA & Launch Prep

**Status: In Progress**

**Gate:** App is walkable end-to-end for every role including talent self-serve upload. Accessibility, PWA, and launch-prep tasks land per sprints-all.md; every sprint ships at least one complete user journey.

---

> **Migration numbering (verified 2026-07-05):** existing migrations run 0001–0021. This sprint starts at **0022** (talent-upload RLS) and **0023** (videos realtime publication). Apply via the `/apply-migration` flow (MCP `apply_migration` → both hudo-dev + hudo-staging), never the SQL editor.

## Tasks

### WAVE 0 — Talent self-serve journey (added 2026-07-05, precedes the planned accessibility/PWA tracks)

---

- [ ] **S4-UPLOAD-001** — Talent self-upload

TASK_ID: S4-UPLOAD-001
TITLE: Talent self-upload (camera-roll picker → pending_review + live status)
BRANCH: feat/s4-S4-UPLOAD-001-talent-self-upload
MODEL: sonnet
STATUS: in_progress
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

> Remaining S4 tasks (S4-ACCESS-001/002, S4-PWA-001, S4-LAUNCH-001..004) to be broken out from tasks/sprints-all.md when this wave closes.
