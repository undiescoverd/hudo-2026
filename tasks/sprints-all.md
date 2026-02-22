# Hudo — Full Sprint Breakdown (Linear Import Reference)

> Generated: 2026-02-21. Covers S0–S4 (76 tasks, 15 with subtasks).
> Use this as the import source when migrating from Baserow to Linear.
> Tasks not in Baserow (added here): S0-INFRA-012, S0-AUTH-007, S1-UPLOAD-005, S1-PLAYER-005.
> Task in Baserow but not previously in sprint-0.md: S0-E2E-001.

---

## Sprint 0 — Infrastructure & Auth

**Goal:** Every environment exists, CI/CD runs, auth works end to end, multi-tenant data model is in place, rate limiting is provisioned, and the repo is ready for feature development.

**Sprint Gate:** An agent can register a new agency, invite a user, have that user sign in, and be correctly scoped to their agency via RLS. All three Supabase environments exist. Vercel preview deploys on every PR. Main deploys to production on merge. Upstash Redis connected and accessible.

---

### INFRA (12 tasks)

#### S0-INFRA-001 — Create GitHub repository
**Size:** XS | **Status:** done | **Blocked by:** none
Create repo with `.gitignore`, `.nvmrc` (Node 20), `README.md`, and branch protection on `main`.

---

#### S0-INFRA-002 — Initialise Next.js project
**Size:** S | **Status:** done | **Blocked by:** S0-INFRA-001
Bootstrap Next.js 14 App Router with TypeScript strict, Tailwind, ESLint, Prettier, and Shadcn UI.

---

#### S0-INFRA-003 — Configure Vercel project
**Size:** S | **Status:** done | **Blocked by:** S0-INFRA-001
Connect repo to Vercel; configure preview deploys on PR and production deploy on `main`; set up three environment variable groups.

---

#### S0-INFRA-004 — Create Supabase projects
**Size:** S | **Status:** not_started | **Blocked by:** S0-INFRA-001
Create three Supabase projects (`hudo-dev`, `hudo-staging`, `hudo-prod`); store connection strings and keys in Vercel environment groups; enable email auth only.

---

#### S0-INFRA-005 — Configure Cloudflare R2
**Size:** S | **Status:** not_started | **Blocked by:** S0-INFRA-001
Create three private R2 buckets; configure CORS to allow uploads from app domain only; enable object versioning; store credentials in Vercel.

---

#### S0-INFRA-006 — Set up GitHub Actions CI pipeline
**Size:** M | **Status:** done | **Blocked by:** S0-INFRA-001
Add CI workflow (lint, type-check, test) on every PR; add PR review workflow using DeepSeek; block merge on failure.

---

#### S0-INFRA-007 — Configure secure HTTP headers
**Size:** S | **Status:** done | **Blocked by:** none
Add CSP, HSTS, X-Frame-Options, X-Content-Type-Options, and Referrer-Policy via `next.config.js`; set `SameSite=Lax` on all cookies.

---

#### S0-INFRA-008 — Create storage abstraction module
**Size:** M | **Status:** not_started | **Blocked by:** S0-INFRA-005
Create `lib/storage.ts` as the single internal interface for all R2 operations; implement put, get, delete, signed URL, and multipart upload functions.

---

#### S0-INFRA-009 — Configure Sentry
**Size:** S | **Status:** done | **Blocked by:** none
Install Sentry Next.js SDK; configure source maps and environment tagging; verify error capture on client and server.

---

#### S0-INFRA-010 — Configure PostHog
**Size:** S | **Status:** done | **Blocked by:** none
Install PostHog SDK; gate script load on cookie consent (script must be absent from DOM before consent is given).

---

#### S0-INFRA-011 — Provision Upstash Redis
**Size:** S | **Status:** not_started | **Blocked by:** S0-INFRA-003
Create Upstash Redis databases for all three environments; create `lib/redis.ts` wrapping the Upstash client for rate limiting only.

---

#### S0-INFRA-012 — Configure Resend ⭐ new
**Size:** S | **Status:** not_started | **Blocked by:** S0-INFRA-001
Create Resend account and API keys; store `RESEND_API_KEY` in Vercel environment groups; verify email delivery from dev domain.

---

### DB (4 tasks)

#### S0-DB-001 — Write base database migration
**Size:** M | **Status:** done | **Blocked by:** none
Create all 11 tables from the PRD schema; enable RLS on every table; apply migration to all three environments.

---

#### S0-DB-002 — Write RLS policies for multi-tenant isolation
**Size:** L | **Status:** not_started | **Blocked by:** S0-DB-001
Write and apply RLS policies ensuring cross-agency isolation across all tables; policies must be bulletproof — this is the primary multi-tenancy mechanism.

- [ ] Agency/membership cluster: `agencies` and `memberships` — cross-agency read/write isolation enforced
- [ ] Video/versions cluster: `videos` and `video_versions` — agents see agency scope, talent sees own only
- [ ] Comments cluster: `comments` — scoped to video access; soft-delete immutability enforced via policy
- [ ] Guest links cluster: `guest_links` — agent CRUD only; no Supabase direct access for guests
- [ ] Notifications cluster: `notifications` and `notification_preferences` — user-scoped reads only
- [ ] Audit log cluster: `audit_log` — insert-only policy; no UPDATE or DELETE policy permitted

---

#### S0-DB-003 — Write RLS policy test suite
**Size:** L | **Status:** not_started | **Blocked by:** S0-DB-002
Create `tests/rls/` with automated tests for every RLS policy; any future policy deletion must cause at least one test to fail.

- [ ] `tests/rls/agencies.test.sql` — cross-agency isolation, owner/admin management scope
- [ ] `tests/rls/videos.test.sql` — talent isolation, agent agency scope, no-RLS-disabled check
- [ ] `tests/rls/comments.test.sql` — soft-delete immutability, cross-agency access denied
- [ ] `tests/rls/audit_log.test.sql` — insert-only verification, update/delete blocked
- [ ] CI step: add RLS test run to `.github/workflows/ci.yml` against `hudo-dev`

---

#### S0-DB-004 — Create database indexes
**Size:** S | **Status:** not_started | **Blocked by:** S0-DB-001
Add all indexes from PRD Section 4.3; verify key dashboard queries use index scans via `EXPLAIN ANALYZE`.

---

### AUTH (7 tasks)

#### S0-AUTH-001 — Implement Supabase Auth
**Size:** M | **Status:** not_started | **Blocked by:** none
Configure Supabase Auth (email/password only); connect Resend for email templates; create auth client and middleware.

- [ ] Configure email/password provider in Supabase; explicitly disable all social providers
- [ ] Connect Resend as email provider for Supabase Auth email templates (confirmation, password reset, invitation)
- [ ] Create auth client module (`lib/auth.ts`) with server and browser exports
- [ ] Configure Next.js middleware (`app/middleware.ts`) for session refresh and unauthenticated redirect

---

#### S0-AUTH-002 — Build registration flow
**Size:** M | **Status:** not_started | **Blocked by:** S0-DB-001, S0-AUTH-001
Agency registration page: create auth user → create agency → create membership (role=owner) → send confirmation email.

- [ ] Registration form UI: agency name, owner name, email, password with inline validation
- [ ] API route: create Supabase auth user → create `agencies` record → create `memberships` record (role=owner)
- [ ] Send confirmation email via Resend template on successful registration
- [ ] Auth callback route (`/auth/callback`) to exchange code and set session cookie
- [ ] E2E test: register → confirm email → land on dashboard → `memberships` row exists with `role=owner`

---

#### S0-AUTH-003 — Build sign-in and sign-out
**Size:** S | **Status:** not_started | **Blocked by:** S0-AUTH-001
Sign-in page with email/password; session cookie set on success; sign-out clears session and redirects.

---

#### S0-AUTH-004 — Implement brute force protection on auth endpoints
**Size:** S | **Status:** not_started | **Blocked by:** S0-AUTH-001, S0-INFRA-011
Rate limit sign-in (10/IP/15 min) and password reset (5/IP/hr) via Upstash Redis; return 429 + `Retry-After` on limit exceeded.

---

#### S0-AUTH-005 — Build invitation flow
**Size:** L | **Status:** not_started | **Blocked by:** S0-DB-001, S0-AUTH-001
Agent or owner invites users by email with a role; invitation token is hashed (SHA-256); expired/reused tokens return 410.

- [ ] Invite UI: email field + role selector (agent/talent); send button triggers API call
- [ ] `POST /api/invitations/send`: generate 32-byte random token, store SHA-256 hash, insert `invitations` row, send Resend email
- [ ] Invitation email template with one-click accept link containing plaintext token in URL
- [ ] Accept page (`/auth/invite/[token]`): validate token, create auth user if new, create `memberships` row, expire token
- [ ] Edge cases: expired token (>7 days) → 410; reused token → 410; duplicate email per agency → 409

---

#### S0-AUTH-006 — Implement role-based middleware
**Size:** M | **Status:** not_started | **Blocked by:** S0-AUTH-003, S0-DB-002
Next.js middleware reads session and membership role; enforces route protection matrix; guests bypass via separate token flow.

- [ ] Define route protection matrix: `/dashboard/*` → any membership, `/settings/*` → owner/admin_agent, `/admin/*` → owner
- [ ] Session check: unauthenticated requests redirect to `/sign-in`
- [ ] Role lookup from `memberships` table on every protected request
- [ ] Guest bypass: `/guest/*` routes skip auth middleware; token validated separately by guest API
- [ ] Route protection tests for all roles and all protected route groups

---

#### S0-AUTH-007 — Build password reset flow ⭐ new
**Size:** S | **Status:** not_started | **Blocked by:** S0-AUTH-001, S0-INFRA-012
Password reset request page → Resend email with link → password update page; rate-limited at 5 requests/IP/hr.

---

### STORAGE (2 tasks)

#### S0-STORAGE-001 — Configure Cloudflare R2 buckets
**Size:** S | **Status:** done | **Blocked by:** S0-INFRA-001
Create three private R2 buckets; configure CORS (PUT from app domain only); enable object versioning; verify unsigned URLs return 403.

---

#### S0-STORAGE-002 — Build R2 signing proxy (playback URL generation)
**Size:** M | **Status:** not_started | **Blocked by:** S0-DB-002, S0-STORAGE-001
`GET /api/videos/:videoId/playback-url` returns a 15-minute signed R2 URL; validates auth and access; never returns a direct R2 URL.

---

### E2E (1 task)

#### S0-E2E-001 — Add Playwright E2E infrastructure ⭐ not in sprint-0.md
**Size:** S | **Status:** not_started | **Blocked by:** S0-INFRA-002
Install and configure Playwright; add E2E test runner to CI; scaffold test directory structure for auth flows.

---

## Sprint 1 — Core Product

**Goal:** Talent can upload a video. Agents can watch it and leave timestamped comments. Both see updates in real time. Versions exist.

**Sprint Gate:** An agent invites a talent. Talent uploads a video. Agent opens the player, leaves a point comment and a range comment. Talent sees the comments in real time. Agent resolves a comment. All data is correctly scoped to the agency via RLS.

---

### Upload (5 tasks)

#### S1-UPLOAD-001 — Build presigned upload flow
**Size:** L | **Status:** not_started | **Blocked by:** S0-INFRA-008, S0-DB-001
API route generates presigned R2 upload URL; client uploads directly to R2; multipart for >50MB; server validates type, size, and container format.

- [ ] Server-side validation: content type (MP4/MOV only), file size (≤10GB), container format check at presign stage
- [ ] Presigned URL generation via `lib/storage.ts` for standard uploads (≤50MB)
- [ ] Multipart upload support: initiate → upload parts → complete (for files >50MB)
- [ ] Client-side direct upload to R2 via presigned URL — video bytes never transit Vercel

---

#### S1-UPLOAD-002 — Enforce storage quota at upload
**Size:** M | **Status:** not_started | **Blocked by:** S1-UPLOAD-001
Check agency storage quota before issuing presigned URL; increment usage only after confirming object exists; decrement atomically on delete.

---

#### S1-UPLOAD-003 — Build upload UI
**Size:** M | **Status:** not_started | **Blocked by:** S1-UPLOAD-001
Drag-and-drop zone with multipart progress bar; error state with retry; success navigates to video page; mobile: tap to select from camera roll.

---

#### S1-UPLOAD-004 — Implement version upload
**Size:** M | **Status:** not_started | **Blocked by:** S1-UPLOAD-001
New file on existing video creates a new version via Postgres RPC (`create_video_version`); RPC locks row, increments, inserts — single transaction, no race conditions.

---

#### S1-UPLOAD-005 — Video metadata form (title/description) ⭐ new
**Size:** XS | **Status:** not_started | **Blocked by:** S1-UPLOAD-003
Inline form on upload success (or video page) to set video title and description; persisted to `videos` table.

---

### Player (5 tasks)

#### S1-PLAYER-001 — Build video player component
**Size:** L | **Status:** not_started | **Blocked by:** S1-UPLOAD-001
HTML5 video player with custom control bar; signed URL from Edge Function (never direct R2 URL); auto-refresh signed URL before expiry.

- [ ] HTML5 `<video>` baseline with native controls fallback
- [ ] Custom control bar: play/pause, scrub timeline, current time/duration, volume, fullscreen
- [ ] Signed URL fetch from `/api/videos/:id/playback-url` — never a direct R2 URL
- [ ] Auto-refresh signed URL before 15-minute expiry without interrupting playback

---

#### S1-PLAYER-002 — Implement comment keyboard shortcuts
**Size:** S | **Status:** not_started | **Blocked by:** S1-PLAYER-001
`C` opens comment at timestamp; `I`/`O` set range in/out points; `X` clears; Space plays/pauses; shortcuts disabled in comment input.

---

#### S1-PLAYER-003 — Build comment timeline overlay
**Size:** M | **Status:** not_started | **Blocked by:** S1-PLAYER-001, S1-COMMENT-001
Timeline bar shows per-user coloured badges at comment timestamps; range comments span In/Out; overlapping badges stack and reveal on hover.

---

#### S1-PLAYER-004 — Mobile player layout
**Size:** M | **Status:** not_started | **Blocked by:** S1-PLAYER-001
Video top half, comment panel bottom half; persistent comment input bar; tapping timeline seeks and opens comment input at that timestamp.

---

#### S1-PLAYER-005 — Video thumbnail generation (client canvas) ⭐ new
**Size:** S | **Status:** not_started | **Blocked by:** S1-UPLOAD-001
After upload completes, capture a frame from the video via client-side canvas; upload thumbnail to R2; store reference in `videos` table.

---

### Comments (5 tasks)

#### S1-COMMENT-001 — Build comment data model
**Size:** M | **Status:** not_started | **Blocked by:** S0-DB-001, S0-DB-002
Migration: `comments` table with point/range types, parent_id for replies, soft-delete (`deleted_at`), resolved state; RLS for all access patterns.

---

#### S1-COMMENT-002 — Build comment API
**Size:** M | **Status:** not_started | **Blocked by:** S1-COMMENT-001
CRUD API: create (point/range), edit own, soft delete, fetch by `videoVersionId`; agents can delete any in agency; hard delete returns error.

---

#### S1-COMMENT-003 — Build comment UI panel
**Size:** M | **Status:** not_started | **Blocked by:** S1-COMMENT-002, S1-PLAYER-001
Comment list sorted by timestamp; avatars with consistent user colours; clicking seeks player; resolved comments visually muted; deleted comments show placeholder if they have replies.

---

#### S1-COMMENT-004 — Implement real-time comment sync
**Size:** M | **Status:** not_started | **Blocked by:** S1-COMMENT-002
Supabase Realtime subscription scoped to `video_version_id` channel only; new/resolved/deleted comments update in panel without page refresh.

---

#### S1-COMMENT-005 — Build comment input
**Size:** S | **Status:** not_started | **Blocked by:** S1-COMMENT-002, S1-PLAYER-002
Text input; Enter submits, Shift+Enter newlines; shows current or range timestamps; 2000 character limit enforced client and server side.

---

### Versioning (2 tasks)

#### S1-VERSION-001 — Build version selector UI
**Size:** S | **Status:** not_started | **Blocked by:** S1-UPLOAD-004
Dropdown/tab strip of all video versions; switching version loads that version's file URL and comment list; active version highlighted.

---

#### S1-VERSION-002 — Version history panel
**Size:** S | **Status:** not_started | **Blocked by:** S1-VERSION-001
List all versions with number, upload date, uploader, file size; agents/admins can set any version as active; talent cannot.

---

## Sprint 2 — Dashboards, Notifications & Guest Links

**Goal:** Agents have a working dashboard. Talent have a working dashboard. Notifications work with batching. Guest links work securely. Plan gates for agent/talent count are in place.

**Sprint Gate:** Agent dashboard shows all talent videos with status. Talent dashboard shows their videos and unread comment count. An agent leaves a comment; talent receives one batched email. A guest link loads the video and comments; direct R2 access is rejected. Adding a 6th agent to a Freemium agency returns 402.

---

### Dashboards (4 tasks)

#### S2-DASH-001 — Build agent dashboard
**Size:** L | **Status:** not_started | **Blocked by:** S1-UPLOAD-003, S1-COMMENT-002
Table/grid of all talent videos in agency with status filter, title/talent search, and bulk status update.

- [ ] Data fetch layer: agency videos with joined talent name, status, comment count, last activity, version number
- [ ] Table/grid component: thumbnail, title, talent name, status badge, comment count, last activity, version columns
- [ ] Status filter (multi-select dropdown) and title/talent search (text input) — client-side or server-side
- [ ] Bulk status update: select multiple rows, apply new status in single operation

---

#### S2-DASH-002 — Build talent dashboard
**Size:** M | **Status:** not_started | **Blocked by:** S1-UPLOAD-003
Grid of talent's own videos only; each card shows thumbnail, title, status badge, and unread comment count.

---

#### S2-DASH-003 — Build video status workflow
**Size:** M | **Status:** not_started | **Blocked by:** S2-DASH-001
Status values: draft → pending_review → in_review → changes_requested → approved; agents set any; talent sets pending_review only; status change logged to audit log.

---

#### S2-DASH-004 — Build PDF export
**Size:** M | **Status:** not_started | **Blocked by:** S1-COMMENT-002
Server-side PDF generation for all comments on a video version; includes title, version, export date, timestamps, commenter names, resolved state.

---

### Plan Gating (1 task)

#### S2-GATE-001 — Implement agent and talent count plan gates
**Size:** M | **Status:** not_started | **Blocked by:** S0-AUTH-005, S0-INFRA-011
Before adding agents or talent, check count against plan limits via Upstash Redis; return 402 with clear message on limit exceeded.

---

### Notifications (4 tasks)

#### S2-NOTIF-001 — Build notification data model
**Size:** M | **Status:** not_started | **Blocked by:** none
Migration: `notifications` and `notification_preferences` tables; RLS ensures users read only their own notifications.

---

#### S2-NOTIF-002 — Implement notification batching
**Size:** L | **Status:** not_started | **Blocked by:** S2-NOTIF-001
Queue notifications on comment creation; Vercel cron (every 5 min) groups by recipient within batch window and sends one Resend email per recipient.

- [ ] Queue writes: on comment creation, insert notification row with `sent_at = NULL`
- [ ] Vercel cron endpoint (`GET /api/cron/notifications`) triggered every 5 minutes
- [ ] Batch grouping logic: group unsent notifications by recipient within their `batch_window_minutes`
- [ ] Resend email template: "N new comments on [video title]" with grouped comment summary
- [ ] Integration test: 10 comments in 2 minutes → exactly 1 email per recipient

---

#### S2-NOTIF-003 — Build in-app notification panel
**Size:** M | **Status:** not_started | **Blocked by:** S2-NOTIF-001
Bell icon with unread count; dropdown lists recent notifications; mark read on click; real-time unread count via Supabase Realtime.

---

#### S2-NOTIF-004 — Build notification preferences UI
**Size:** S | **Status:** not_started | **Blocked by:** S2-NOTIF-001
User can toggle email notifications on/off and set batch window (5, 15, 30, or 60 minutes).

---

### Guest Links (4 tasks)

#### S2-GUEST-001 — Build guest link data model
**Size:** M | **Status:** not_started | **Blocked by:** none
Migration: `guest_links` table; token stored as SHA-256 hash — plaintext never persisted to DB or logs; 32-byte cryptographically random token.

---

#### S2-GUEST-002 — Build guest link API
**Size:** M | **Status:** not_started | **Blocked by:** S2-GUEST-001, S0-INFRA-011
Generate and revoke guest links; public `GET /api/guest/:token` validates with constant-time comparison; rate-limited 20/IP/min via Redis; view count incremented on valid access.

---

#### S2-GUEST-003 — Build guest playback
**Size:** M | **Status:** not_started | **Blocked by:** S2-GUEST-002
Guest accesses `/guest/:token` without sign-in; playback URL from Edge Function (never direct R2); comments read-only; no access to any other page.

---

#### S2-GUEST-004 — Guest link management UI
**Size:** S | **Status:** not_started | **Blocked by:** S2-GUEST-002
Agent generates guest link from video page; optional expiry date; list of active links with view count; one-click revoke.

---

## Sprint 3 — Billing, Compliance & Security Hardening

**Goal:** Billing gates work. Agencies cannot exceed their plan. Compliance flows are in place. Security hardening complete before launch.

**Sprint Gate:** A free-tier agency cannot add a sixth agent. A paid agency can. DPA must be accepted before plan activation. GDPR erasure anonymises audit log. All rate limits are active. Storage reconciliation job runs without errors.

---

### Billing (6 tasks)

#### S3-BILLING-001 — Configure Stripe
**Size:** M | **Status:** not_started | **Blocked by:** none
Create Stripe products and prices (Freemium free, Starter £49/mo, Studio £149/mo, Agency Pro £349/mo); enable Stripe Tax for UK VAT; store keys in Vercel (never client bundle).

---

#### S3-BILLING-002 — Build Stripe webhook handler
**Size:** L | **Status:** not_started | **Blocked by:** S3-BILLING-001
Process Stripe events: validate signature → process → commit → return 200; idempotent; syncs subscription state to `agencies` table.

- [ ] Route setup (`POST /api/webhooks/stripe`) with raw body parsing (no JSON middleware interference)
- [ ] Stripe signature validation — reject missing/invalid `Stripe-Signature` header with 400
- [ ] Event handlers: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- [ ] Idempotency check: use Stripe event ID to skip already-processed events (no duplicate records)
- [ ] Sync subscription state to `agencies` table on each successfully processed event

---

#### S3-BILLING-003 — Implement full plan feature gates
**Size:** M | **Status:** not_started | **Blocked by:** S3-BILLING-002
Add storage hard cap enforcement at plan level and grace period logic: 7-day access after `invoice.payment_failed`, then block uploads and new invites.

---

#### S3-BILLING-004 — Collect legal entity data for invoices
**Size:** M | **Status:** not_started | **Blocked by:** S3-BILLING-001
During plan upgrade: collect legal name, billing address, VAT number (optional); store on `agencies` table; pass to Stripe customer metadata; required before plan activation.

---

#### S3-BILLING-005 — Build billing UI
**Size:** M | **Status:** not_started | **Blocked by:** S3-BILLING-002
Settings → Billing: current plan, usage (agents, talent, storage), next renewal date, payment method; upgrade/downgrade and invoice history via Stripe Customer Portal.

---

#### S3-BILLING-006 — DPA acceptance gate
**Size:** M | **Status:** not_started | **Blocked by:** S3-BILLING-001
Present Data Processing Agreement before any paid plan activates; owner must accept via checkbox; acceptance timestamp and IP stored on `agencies` table.

---

### Compliance (3 tasks)

#### S3-COMPLY-001 — Build audit log
**Size:** M | **Status:** not_started | **Blocked by:** none
Migration: `audit_log` table with indexes on `agency_id` and `created_at`; write helper; instrument all required event types; entries immutable (insert-only).

- [ ] Migration: `audit_log` table with `id`, `agency_id`, `actor_id`, `actor_name`, `action`, `resource_type`, `resource_id`, `metadata` (JSONB), `created_at`; indexes on `agency_id` and `created_at`
- [ ] Write helper `lib/audit.ts`: `logEvent(action, resourceType, resourceId, metadata)` for use across the codebase
- [ ] Instrument status changes (`S2-DASH-003`) and version uploads (`S1-UPLOAD-001`, `S1-UPLOAD-004`)
- [ ] Instrument member invitations (`S0-AUTH-005`), role changes, guest link creation/revocation (`S2-GUEST-002`)
- [ ] Instrument billing events (`S3-BILLING-002`): subscription created, updated, cancelled, payment failed

---

#### S3-COMPLY-002 — Implement right-to-erasure
**Size:** L | **Status:** not_started | **Blocked by:** S3-COMPLY-001
`DELETE /api/users/:id/data`: anonymise audit log, revoke sessions, remove memberships, delete personal data; videos and comments remain (agency-owned).

- [ ] API endpoint `DELETE /api/users/:id/data` — owner or admin_agent auth check enforced
- [ ] Anonymise audit log: replace `actor_name` → "Deleted User", set `actor_id` → null
- [ ] Revoke all Supabase auth sessions for the user
- [ ] Remove all rows from `memberships` for the user
- [ ] Delete personal data from `users` table (preserve `id` as tombstone to maintain referential integrity)
- [ ] Test: after erasure, user cannot sign in; audit log shows "Deleted User"; data not retrievable via any API endpoint

---

#### S3-COMPLY-003 — Build cookie consent banner
**Size:** M | **Status:** not_started | **Blocked by:** none
Cookie consent on first visit: session/auth always active; PostHog script must not load before consent (not just event-blocked); preference in `localStorage`.

---

### Security Hardening (4 tasks)

#### S3-SEC-001 — Implement API rate limiting (full audit)
**Size:** M | **Status:** not_started | **Blocked by:** S0-INFRA-011
Confirm all rate limits are Redis-backed and return 429 + `Retry-After`: upload (10/user/hr), comments (60/user/hr), guest link validation (20/IP/min), auth endpoints.

---

#### S3-SEC-002 — Confirm R2 bucket is fully private
**Size:** S | **Status:** not_started | **Blocked by:** S0-STORAGE-002
Verify no public bucket policy; verify all playback URLs are signed (15 min); verify guest playback proxies through Edge Function; verify CORS rejects non-app domains.

---

#### S3-SEC-003 — Stripe webhook security audit
**Size:** S | **Status:** not_started | **Blocked by:** S3-BILLING-002
Confirm signature validation on every webhook; confirm idempotency prevents duplicate records; confirm Stripe secret key absent from client bundle.

---

#### S3-SEC-004 — Storage reconciliation job
**Size:** M | **Status:** not_started | **Blocked by:** S1-UPLOAD-002, S0-INFRA-009
Nightly cron: recalculate actual R2 usage by agency prefix; compare to `storage_usage` in `agencies`; log drift >1MB to Sentry; does not auto-correct.

---

## Sprint 4 — Polish & Launch Prep

**Goal:** The product is accessible, stable, and ready for the first paying customer. PWA installs. All known issues resolved.

**Sprint Gate:** WCAG 2.1 AA audit passes with no critical violations. PWA installs on iOS and Android. Smoke test suite passes against staging. Terms of Service and Privacy Policy are live. First agency can be onboarded end-to-end.

---

### Accessibility (2 tasks)

#### S4-ACCESS-001 — WCAG 2.1 AA audit
**Size:** L | **Status:** not_started | **Blocked by:** none
Run Axe audit on all key pages; fix all critical and serious violations; ensure keyboard navigation is logical and focus is always visible.

- [ ] Axe audit + fix: sign-in page — zero critical/serious violations, logical tab order
- [ ] Axe audit + fix: agent and talent dashboard pages — zero critical/serious violations
- [ ] Axe audit + fix: video page (player + comment panel + timeline overlay) — zero critical/serious violations
- [ ] Axe audit + fix: settings pages — zero critical/serious violations
- [ ] Axe audit + fix: billing page — zero critical/serious violations

---

#### S4-ACCESS-002 — Screen reader testing
**Size:** M | **Status:** not_started | **Blocked by:** S4-ACCESS-001
Test core flows with VoiceOver (iOS/macOS) and NVDA (Windows); player controls, comment list, and comment input must be fully navigable by keyboard and screen reader.

---

### PWA (1 task)

#### S4-PWA-001 — Configure PWA manifest and service worker
**Size:** M | **Status:** not_started | **Blocked by:** none
Web app manifest (name, icons 192px/512px, theme colour, `display: standalone`); service worker caches shell assets and serves offline fallback page.

---

### Launch Readiness (4 tasks)

#### S4-LAUNCH-001 — Legal pages
**Size:** S | **Status:** not_started | **Blocked by:** none
Create `/terms`, `/privacy` (listing all subprocessors), and `/dpa` pages; accessible without sign-in; linked from footer.

---

#### S4-LAUNCH-002 — Smoke test suite
**Size:** L | **Status:** not_started | **Blocked by:** none
Automated smoke tests against staging covering the full user journey; run in CI on every merge to `main`.

- [ ] Flow: register agency → confirm email → land on dashboard
- [ ] Flow: invite talent → accept invite → talent dashboard accessible
- [ ] Flow: upload video → progress visible → video page loads with player
- [ ] Flow: leave point comment → resolve comment → resolved state displayed correctly
- [ ] Flow: export PDF → downloads with correct content (title, timestamps, commenter names)
- [ ] Flow: generate guest link → guest can play video and read comments without sign-in
- [ ] Flow: upgrade plan → Stripe checkout completes → plan updated in DB and UI

---

#### S4-LAUNCH-003 — Production environment validation
**Size:** M | **Status:** not_started | **Blocked by:** S4-LAUNCH-002
Run smoke test suite against production with a test agency; verify Sentry, PostHog, Stripe webhooks, and R2 all work in production; delete test agency after validation.

---

#### S4-LAUNCH-004 — Onboarding flow
**Size:** M | **Status:** not_started | **Blocked by:** none
First-time agency owner sees guided checklist: invite first agent, invite first talent, upload first video; checklist dismisses on completion; returning users do not see it.

---

## Summary: Task & Subtask Counts by Sprint

| Sprint | Tasks | Tasks with subtasks | Subtasks |
|--------|------:|--------------------:|---------:|
| S0 — Infrastructure & Auth | 26 | 6 | 30 |
| S1 — Core Product | 17 | 2 | 8 |
| S2 — Dashboards, Notifications & Guest Links | 13 | 2 | 9 |
| S3 — Billing, Compliance & Security | 13 | 3 | 16 |
| S4 — Polish & Launch Prep | 7 | 2 | 12 |
| **Total** | **76** | **15** | **75** |

### Tasks with subtasks

| Task ID | Title | Subtask count |
|---------|-------|:-------------:|
| S0-AUTH-001 | Implement Supabase Auth | 4 |
| S0-AUTH-002 | Build registration flow | 5 |
| S0-AUTH-005 | Build invitation flow | 5 |
| S0-AUTH-006 | Implement role-based middleware | 5 |
| S0-DB-002 | Write RLS policies for multi-tenant isolation | 6 |
| S0-DB-003 | Write RLS policy test suite | 5 |
| S1-UPLOAD-001 | Build presigned upload flow | 4 |
| S1-PLAYER-001 | Build video player component | 4 |
| S2-DASH-001 | Build agent dashboard | 4 |
| S2-NOTIF-002 | Implement notification batching | 5 |
| S3-BILLING-002 | Build Stripe webhook handler | 5 |
| S3-COMPLY-001 | Build audit log | 5 |
| S3-COMPLY-002 | Implement right-to-erasure | 6 |
| S4-ACCESS-001 | WCAG 2.1 AA audit | 5 |
| S4-LAUNCH-002 | Smoke test suite | 7 |

### New tasks (not previously in hudo-sprint-plan.md)

| Task ID | Title | Sprint | Size | Blocked by |
|---------|-------|--------|------|------------|
| S0-INFRA-012 | Configure Resend | S0 | S | S0-INFRA-001 |
| S0-AUTH-007 | Build password reset flow | S0 | S | S0-AUTH-001, S0-INFRA-012 |
| S0-E2E-001 | Add Playwright E2E infrastructure | S0 | S | S0-INFRA-002 |
| S1-UPLOAD-005 | Video metadata form (title/description) | S1 | XS | S1-UPLOAD-003 |
| S1-PLAYER-005 | Video thumbnail generation (client canvas) | S1 | S | S1-UPLOAD-001 |
