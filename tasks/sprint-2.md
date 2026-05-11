# Sprint 2 — Dashboards, Notifications & Guest Links

**Status: In Progress**

**Gate:** Agent dashboard shows all talent videos with status. Talent dashboard shows their videos and unread comment count. Agent comments → talent gets one batched email. Guest link loads video and comments; direct R2 access rejected. 6th agent on Freemium → 402.

---

## Tasks

### WAVE 1 — App Shell (solo, must land first)

---

- [ ] **S2-SHELL-001** — Build app shell

TASK_ID: S2-SHELL-001
TITLE: Build app shell
BRANCH: feat/s2-shell-001-app-shell
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - app/(dashboard)/layout.tsx wraps all dashboard pages with <AppHeader>
  - <AppHeader>: logo (links to /videos), nav links (Videos, Upload for agents+), user display name, sign-out button
  - app/page.tsx: signed-out → redirect /auth/signin; signed-in → redirect /videos
  - signin default redirect (no ?redirect param) → /videos
  - app/(dashboard)/videos/page.tsx: list of all videos accessible to current user — thumbnail, title, status badge, link to /videos/[id]
  - /videos/[id] has a back link to /videos
  - pnpm type-check && pnpm lint green
FILES:
  - app/(dashboard)/layout.tsx
  - components/layout/AppHeader.tsx
  - app/page.tsx
  - app/auth/signin/signin-form.tsx (update safeRedirect default)
  - app/(dashboard)/videos/page.tsx
NOTES: Connective tissue for S1 features. Must be walkable: register → sign in → /videos list → click video → player + comments → upload new video. Check if GET /api/videos route exists before adding; reuse lib/supabase-server.ts for data fetch.

---

### WAVE 2 — Dashboards + Gating (parallel after SHELL-001)

### DASHBOARDS (4 tasks)

---

- [ ] **S2-DASH-001** — Build agent dashboard

TASK_ID: S2-DASH-001
TITLE: Build agent dashboard
BRANCH: feat/s2-dash-001-agent-dashboard
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Data fetch returns agency videos with joined talent name, status, comment count, last activity, version number
  - Table/grid shows thumbnail, title, talent name, status badge, comment count, last activity, version columns
  - Status filter (multi-select) and title/talent search (text input) filter the list
  - Bulk status update: select multiple rows and apply a new status in one operation
  - RLS-scoped to current agency via memberships; no cross-agency data leakage
FILES:
  - app/(dashboard)/dashboard/page.tsx
  - components/dashboard/AgentDashboard.tsx
  - components/dashboard/VideoTable.tsx
  - components/dashboard/StatusFilter.tsx
  - components/dashboard/BulkStatusUpdate.tsx
  - app/api/dashboard/videos/route.tsx
  - lib/dashboard.ts
NOTES: Size L — must run pr-review-toolkit:code-reviewer before merge. Server-side filtering preferred for large datasets.

---

- [ ] **S2-DASH-002** — Build talent dashboard

TASK_ID: S2-DASH-002
TITLE: Build talent dashboard
BRANCH: feat/s2-dash-002-talent-dashboard
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Grid of the talent's own videos only (RLS-enforced, never agency-wide)
  - Each card shows thumbnail, title, status badge, and unread comment count
  - Card click navigates to the video page
  - Empty state shown when talent has no videos
FILES:
  - app/(dashboard)/talent/page.tsx
  - components/dashboard/TalentDashboard.tsx
  - components/dashboard/VideoCard.tsx
NOTES: Unread count = comments where comment.created_at > last_seen_at for that user/video.

---

- [ ] **S2-DASH-003** — Build video status workflow

TASK_ID: S2-DASH-003
TITLE: Build video status workflow
BRANCH: feat/s2-dash-003-status-workflow
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: S2-DASH-001
ACCEPTANCE_CRITERIA:
  - Status enum: draft → pending_review → in_review → changes_requested → approved
  - Agents can set any status; talent can only set pending_review (403 otherwise)
  - PATCH /api/videos/:id/status validates transition and writes to audit_log
  - Audit log entry includes actor, video_id, old_status, new_status, timestamp
FILES:
  - app/api/videos/[id]/status/route.ts
  - lib/video-status.ts
  - components/dashboard/StatusBadge.tsx
NOTES: audit_log is insert-only — no update/delete policy. Use existing audit_log table from S0.

---

- [ ] **S2-DASH-004** — Build PDF export

TASK_ID: S2-DASH-004
TITLE: Build PDF export
BRANCH: feat/s2-dash-004-pdf-export
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - GET /api/videos/:id/versions/:versionId/comments/export returns a PDF
  - PDF includes: video title, version number, export date, generator name
  - Each comment row: timestamp, commenter name, body, resolved state
  - Generation runs server-side; rate-limited
  - Talent can export own videos; agents can export any in agency
FILES:
  - app/api/videos/[id]/versions/[versionId]/comments/export/route.ts
  - lib/pdf-export.ts
NOTES: Use a serverless-compatible PDF lib (e.g. pdfkit or @react-pdf/renderer). No headless browser.

---

### PLAN GATING (1 task)

---

- [ ] **S2-GATE-001** — Implement agent and talent count plan gates

TASK_ID: S2-GATE-001
TITLE: Implement agent and talent count plan gates
BRANCH: feat/s2-gate-001-plan-gates
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Before adding an agent or talent, current count is checked against plan limits
  - Limit lookup cached in Upstash Redis (TTL ≤60s) to avoid hot-path DB read
  - Returns 402 with `{ error: "plan_limit_exceeded", limit, current }` on overflow
  - Freemium: 5 agents, 10 talent (configurable per plan)
  - Cache invalidated on plan change or member add/remove
FILES:
  - lib/plan-gates.ts
  - app/api/agencies/[id]/members/route.ts
  - app/api/agencies/[id]/talent/route.ts
NOTES: Plan limits live in `plans` table (S0). Cache key: `plan-limit:{agency_id}:{role}`.

---

### WAVE 3 — Notifications (parallel after WAVE 2)

### NOTIFICATIONS (4 tasks)

---

- [ ] **S2-NOTIF-001** — Build notification data model

TASK_ID: S2-NOTIF-001
TITLE: Build notification data model
BRANCH: feat/s2-notif-001-data-model
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Existing `notifications` table (0001) extended with: payload jsonb, sent_at timestamptz (nullable) — both via ADD COLUMN IF NOT EXISTS
  - Existing `notification_preferences` table (0001) extended with: updated_at timestamptz NOT NULL DEFAULT now() — via ADD COLUMN IF NOT EXISTS
  - RLS already in place (0002): notifications_select/update_own use `recipient_id = auth.uid()`, notification_prefs_*. No RLS changes required.
  - Indexes added: notifications(recipient_id, read_at), notifications(recipient_id, sent_at), notifications(agency_id, created_at) — all CREATE INDEX IF NOT EXISTS
  - Migration is fully idempotent (re-runnable without error)
FILES:
  - supabase/migrations/0012_notifications.sql
NOTES: Base tables + RLS already exist (0001/0002). Migration is ALTER + CREATE INDEX only — no CREATE TABLE, no new RLS policies. Existing column is `recipient_id` not `user_id` — keep it; do not rename. Mandatory devsecops-security-engineer review (touches RLS-protected tables).

---

- [ ] **S2-NOTIF-002** — Implement notification batching

TASK_ID: S2-NOTIF-002
TITLE: Implement notification batching
BRANCH: feat/s2-notif-002-batching
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: S2-NOTIF-001
ACCEPTANCE_CRITERIA:
  - On comment creation, insert notification rows with `sent_at = NULL` for each recipient
  - GET /api/cron/notifications wired to Vercel cron (every 5 minutes)
  - Cron groups unsent notifications by recipient within their batch_window_minutes
  - One Resend email per recipient per run, summarising N comments on each affected video
  - Integration test: 10 comments in 2 minutes → exactly 1 email per recipient
  - Failed sends are retried on next cron tick; sent_at only set after success
FILES:
  - app/api/cron/notifications/route.ts
  - lib/notifications.ts
  - lib/email-templates/comments-batch.tsx
  - vercel.json
NOTES: Size L — must run pr-review-toolkit:code-reviewer before merge. Cron secret via CRON_SECRET env var.

---

- [ ] **S2-NOTIF-003** — Build in-app notification panel

TASK_ID: S2-NOTIF-003
TITLE: Build in-app notification panel
BRANCH: feat/s2-notif-003-in-app-panel
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: S2-NOTIF-001
ACCEPTANCE_CRITERIA:
  - Bell icon in header shows unread count badge
  - Dropdown lists recent notifications (newest first, capped at 50)
  - Clicking a notification marks it read (PATCH /api/notifications/:id) and navigates to target
  - Real-time unread count updates via Supabase Realtime on `notifications` filtered by user_id
  - "Mark all read" action sets read_at on all unread for current user
FILES:
  - components/notifications/NotificationBell.tsx
  - components/notifications/NotificationPanel.tsx
  - hooks/useNotifications.ts
  - app/api/notifications/route.ts
  - app/api/notifications/[id]/route.ts
NOTES: Realtime channel scoped per CLAUDE.md — filter by user_id, never broadcast agency-wide.

---

- [ ] **S2-NOTIF-004** — Build notification preferences UI

TASK_ID: S2-NOTIF-004
TITLE: Build notification preferences UI
BRANCH: feat/s2-notif-004-preferences
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: S2-NOTIF-001
ACCEPTANCE_CRITERIA:
  - Settings page exposes email_enabled toggle and batch_window_minutes select (5, 15, 30, 60)
  - PATCH /api/notifications/preferences updates the current user's row
  - Defaults applied when no row exists (email_enabled=true, batch_window=15)
  - Validation: batch_window_minutes must be one of allowed values
FILES:
  - app/(dashboard)/settings/notifications/page.tsx
  - components/settings/NotificationPreferences.tsx
  - app/api/notifications/preferences/route.ts
NOTES: Reuse existing settings layout from S0/S1.

---

### WAVE 3 — Guest Links (parallel after WAVE 2)

### GUEST LINKS (4 tasks)

---

- [ ] **S2-GUEST-001** — Build guest link data model

TASK_ID: S2-GUEST-001
TITLE: Build guest link data model
BRANCH: feat/s2-guest-001-data-model
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Existing `guest_links` table (0001) already covers all required columns including `agency_id`, `token_hash text UNIQUE` (sha-256 hex), `expires_at`, `revoked_at`, `view_count`, `last_viewed_at`
  - Token plaintext NEVER stored — only sha-256 hash persisted
  - 32-byte cryptographically random token generation helper added in lib/guest-tokens.ts (generate, hash, timing-safe verify)
  - RLS already in place (0002): guest_links_select/insert/update for agents+ in agency; no public read policy. No RLS changes required.
  - Indexes added: guest_links(video_id), guest_links(expires_at) — token_hash UNIQUE already exists
  - Tests in lib/guest-tokens.test.ts cover: token uniqueness, hash determinism, timing-safe verification, never logs plaintext
FILES:
  - supabase/migrations/0013_guest_links.sql
  - lib/guest-tokens.ts
  - lib/guest-tokens.test.ts
NOTES: Base table + RLS already exist (0001/0002). Migration is CREATE INDEX IF NOT EXISTS only — no CREATE TABLE, no new RLS, no column type change (keep token_hash as text). Mandatory devsecops-security-engineer review. Use crypto.timingSafeEqual; never log plaintext tokens.

---

- [ ] **S2-GUEST-002** — Build guest link API

TASK_ID: S2-GUEST-002
TITLE: Build guest link API
BRANCH: feat/s2-guest-002-api
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: S2-GUEST-001
ACCEPTANCE_CRITERIA:
  - POST /api/videos/:id/guest-links generates a link, returns plaintext token ONCE (never again)
  - DELETE /api/guest-links/:id revokes a link (sets revoked_at)
  - Public GET /api/guest/:token validates with constant-time comparison against token_hash
  - Validation rejects revoked, expired, or unknown tokens (404, never 401 — no token enumeration)
  - Rate limited: 20 requests / IP / minute via Upstash Redis on the public endpoint
  - view_count and last_viewed_at incremented on valid access
FILES:
  - app/api/videos/[id]/guest-links/route.ts
  - app/api/guest-links/[id]/route.ts
  - app/api/guest/[token]/route.ts
  - lib/guest-tokens.ts
NOTES: Mandatory devsecops-security-engineer review. Use timingSafeEqual; never log plaintext tokens.

---

- [ ] **S2-GUEST-003** — Build guest playback

TASK_ID: S2-GUEST-003
TITLE: Build guest playback
BRANCH: feat/s2-guest-003-playback
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: S2-GUEST-002
ACCEPTANCE_CRITERIA:
  - Public route /guest/:token loads without sign-in
  - Playback URL signed via API route (never direct R2 URL exposed to client)
  - Comments rendered read-only — no input, no reply, no resolve controls
  - Guest cannot navigate to any other authenticated page; layout suppresses nav
  - Direct R2 URL access rejected (verified by playback URL signing proxy)
FILES:
  - app/guest/[token]/page.tsx
  - app/guest/[token]/layout.tsx
  - app/api/guest/[token]/playback-url/route.ts
  - components/guest/GuestPlayer.tsx
  - components/guest/GuestComments.tsx
NOTES: Mandatory devsecops-security-engineer review. Reuse VideoPlayer; pass read-only flag.

---

- [ ] **S2-GUEST-004** — Guest link management UI

TASK_ID: S2-GUEST-004
TITLE: Guest link management UI
BRANCH: feat/s2-guest-004-management-ui
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: S2-GUEST-002
ACCEPTANCE_CRITERIA:
  - Agent can generate a guest link from the video page; modal shows plaintext token + copy button (shown once)
  - Optional expiry date picker
  - List of active links with view_count and last_viewed_at
  - One-click revoke action with confirmation
  - Revoked links visually distinct and not copyable
FILES:
  - components/guest/GuestLinkModal.tsx
  - components/guest/GuestLinkList.tsx
  - app/(dashboard)/videos/[id]/page.tsx
NOTES: Plaintext token displayed exactly once at creation — make this obvious in the UI.
