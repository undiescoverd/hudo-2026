# Hudo PRD — Section 6: Sprint Plan

**Version 1.2 — post Codex review + accepted amendments**
**Status: Ready for agent execution**

---

## 6.0 Sprint Plan Principles

Every task is agent-consumable. Each task has a unique ID, a single owner, a clear definition of done expressed as verifiable acceptance criteria, an estimated size, and blocking dependencies noted explicitly. No task is ambiguous. No task spans more than one concern.

Tasks are executed by Claude Code agents working from feature branches off `main`. A Codex review agent reviews every PR. Sprint gate criteria apply at the end of each sprint. No sprint begins until the previous sprint has passed its gate.

---

## 6.1 Task ID Convention

```
[SPRINT]-[AREA]-[NUMBER]
```

Examples: `S0-INFRA-001`, `S1-PLAYER-003`, `S3-BILLING-002`

---

## 6.2 Task Size Convention

- **XS** — under 1 hour
- **S** — 1–3 hours
- **M** — 3–6 hours
- **L** — 6–12 hours
- **XL** — full day, should be split if possible

---

## 6.3 Accepted Amendments from Review

The following changes were accepted after Codex review and are baked into v1.2:

1. Upstash Redis added (S0-INFRA-011) for reliable rate limiting across stateless Vercel functions
2. Storage reconciliation job added (S3-SEC-004) to catch usage drift from failed/aborted uploads
3. Version increment moved to Postgres RPC function (S1-UPLOAD-004) to prevent race conditions
4. Constant-time token comparison specified for guest link validation (S2-GUEST-002)
5. Audit log indexes on `agency_id` and `created_at` added (S3-COMPLY-001)
6. PostHog script must not load (not just be blocked) before cookie consent (S3-COMPLY-003)
7. Stripe webhook pattern clarified: validate → process → commit → return 200 (S3-BILLING-002)
8. H.264 container validation added at presign stage — codec-level validation deferred post-MVP (S1-UPLOAD-001)
9. Agent/talent count plan gating moved to Sprint 2; storage quota remains Sprint 1
10. Social auth explicitly marked Post-MVP in sprint plan

**Rejected amendments:**
- Legal entity data at registration — conversion risk, keep at upgrade time
- Legal pages live at sprint plan level — no change

---

## Sprint 0 — Infrastructure & Auth

**Goal:** Every environment exists, CI/CD runs, auth works end to end, multi-tenant data model is in place, rate limiting infrastructure is provisioned, and the repo is ready for feature development.

**Sprint Gate:** An agent can register a new agency, invite a user, have that user sign in, and be correctly scoped to their agency via RLS. All three Supabase environments exist. Vercel preview deploys on every PR. Main deploys to production on merge. Upstash Redis connected and accessible.

---

### Infrastructure

**S0-INFRA-001** — Create GitHub repository
- Create repo named `hudo` under company GitHub org
- Add `.gitignore` for Next.js, `.nvmrc` pinned to Node 20
- Add `README.md` with project name and stack summary
- **Size:** XS
- **Done when:** Repo exists, pushes succeed, branch protection on `main` requires PR + passing CI

**S0-INFRA-002** — Initialise Next.js project
- `npx create-next-app@latest` with App Router, TypeScript, Tailwind, ESLint
- Install and configure Shadcn UI
- Delete all placeholder content, confirm clean build
- **Size:** S
- **Done when:** `npm run build` exits 0 with no errors or warnings

**S0-INFRA-003** — Configure Vercel project
- Connect repo to Vercel, set up preview deploys on PR, production deploy on `main`
- Configure environment variable groups: `development`, `preview`, `production`
- **Size:** S
- **Done when:** A test PR creates a unique preview URL; merge to `main` deploys to production domain

**S0-INFRA-004** — Create Supabase projects
- Create three Supabase projects: `hudo-dev`, `hudo-staging`, `hudo-prod`
- Store connection strings and anon/service keys in Vercel environment variable groups
- **Size:** S
- **Done when:** All three projects exist, environment variables are set and accessible in each deployment context

**S0-INFRA-005** — Configure Cloudflare R2
- Create R2 buckets: `hudo-dev`, `hudo-staging`, `hudo-prod`
- Set bucket access to private — no public access, no public fallback
- Configure CORS policy to allow uploads from app domain only
- Enable object versioning on all buckets
- Store R2 credentials in Vercel environment variable groups
- **Size:** S
- **Done when:** A test file can be uploaded to `hudo-dev` bucket via API key; bucket rejects unauthenticated requests; CORS rejects requests from non-app domains

**S0-INFRA-006** — Set up GitHub Actions CI pipeline
- Lint, type-check, and test on every PR
- Block merge if any check fails
- Store Codex API key as GitHub secret
- Add Codex PR review workflow using prompt at `/.github/codex-review-prompt.md`
- **Size:** M
- **Done when:** A PR with a type error fails CI; a clean PR passes and receives a Codex review comment

**S0-INFRA-007** — Configure secure HTTP headers
- Add `next.config.js` headers: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
- Set `SameSite=Lax` on all cookies
- **Size:** S
- **Done when:** `curl -I` against preview URL returns all required headers; CSP does not block app functionality

**S0-INFRA-008** — Create storage abstraction module
- Create `lib/storage.ts` as the single internal interface for all R2 operations
- Implement: `uploadFile`, `getSignedUrl` (15-minute expiry), `deleteFile`, `checkFileExists`, `initMultipartUpload`, `uploadPart`, `completeMultipartUpload`, `abortMultipartUpload`
- No other file may import the S3 client directly
- **Size:** M
- **Done when:** Unit tests cover all eight functions; no other file imports the S3 client directly

**S0-INFRA-009** — Configure Sentry
- Install Sentry SDK, configure for Next.js App Router
- Source maps uploaded on build
- Errors captured in all three environments with environment tag
- **Size:** S
- **Done when:** A deliberately thrown test error appears in Sentry dashboard with correct environment tag and stack trace

**S0-INFRA-010** — Configure PostHog
- Install PostHog SDK
- Do not load PostHog script until user accepts analytics cookies — script must not be present in DOM before consent
- **Size:** S
- **Done when:** PostHog script is absent from DOM before consent; script loads and events fire only after consent given

**S0-INFRA-011** — Provision Upstash Redis
- Create Upstash Redis database for each environment: dev, staging, production
- Store `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Vercel environment variable groups
- Create `lib/redis.ts` wrapping Upstash client — used exclusively for rate limiting counters
- **Size:** S
- **Blocked by:** S0-INFRA-003
- **Done when:** A test API route can increment and read a Redis counter; counters are environment-isolated

---

### Database Schema & Multi-Tenancy

**S0-DB-001** — Write base database migration
- Create tables: `agencies`, `memberships`, `users` (no `agency_id` column), `invitations`
- `memberships` columns: `id`, `user_id`, `agency_id`, `role` (enum: `owner`, `admin_agent`, `agent`), `created_at`
- One user can have memberships at multiple agencies
- Apply migration to `hudo-dev`
- **Size:** M
- **Done when:** Migration runs without error; `memberships` table exists; `users` table has no `agency_id` column

**S0-DB-002** — Write RLS policies for multi-tenant isolation
- All queries scoped to the user's current agency membership
- Agents can only read/write data belonging to their agency
- Talent can only read data assigned to them
- Owner and Admin Agent roles can manage memberships within their agency
- **Size:** L
- **Blocked by:** S0-DB-001
- **Done when:** An agent from Agency A cannot read any data from Agency B in a direct Supabase query; verified with RLS test suite

**S0-DB-003** — Write RLS policy test suite
- Create `tests/rls/` directory
- Write automated tests for every RLS policy covering: correct access granted, cross-agency access denied, talent access scoped correctly, guest access scoped correctly
- Include test that verifies no table has RLS accidentally disabled
- Include test simulating raw SQL bypass attempt
- Tests run in CI against `hudo-dev`
- **Size:** L
- **Blocked by:** S0-DB-002
- **Done when:** All RLS tests pass in CI; any RLS policy deletion causes at least one test to fail

**S0-DB-004** — Create database indexes
- Add indexes: `memberships(user_id)`, `memberships(agency_id)`, `video_versions(video_id)`, `comments(video_version_id)`, `comments(resolved)`, `videos(agency_id)`, `notifications(user_id)`
- **Size:** S
- **Blocked by:** S0-DB-001
- **Done when:** Migration applies cleanly; `EXPLAIN ANALYZE` on key dashboard queries shows index scans, not sequential scans

---

### Auth

**S0-AUTH-001** — Implement Supabase Auth
- Configure Supabase Auth in `hudo-dev`
- Enable email/password provider only
- All social providers (Google, Microsoft, etc.) are Post-MVP — disable explicitly
- Configure email templates via Resend for: confirmation, password reset, invitation
- **Size:** M
- **Done when:** A user can register with email/password and receive a confirmation email via Resend

**S0-AUTH-002** — Build registration flow
- Agency registration page: agency name, owner name, email, password
- On submit: create Supabase auth user, create `agencies` record, create `memberships` record with role `owner`
- Redirect to dashboard on success
- **Size:** M
- **Blocked by:** S0-DB-001, S0-AUTH-001
- **Done when:** End-to-end test: register → confirm email → land on dashboard → membership record exists in DB with role `owner`

**S0-AUTH-003** — Build sign-in and sign-out
- Sign-in page with email/password
- Supabase session cookie set on success
- Sign-out clears session and redirects to sign-in
- **Size:** S
- **Blocked by:** S0-AUTH-001
- **Done when:** User can sign in, session persists across page refresh, sign-out clears session

**S0-AUTH-004** — Implement brute force protection on auth endpoints
- Rate limit sign-in attempts: 10 per IP per 15 minutes via Upstash Redis
- Rate limit password reset requests: 5 per IP per hour via Upstash Redis
- Return 429 with `Retry-After` header on limit exceeded
- **Size:** S
- **Blocked by:** S0-AUTH-001, S0-INFRA-011
- **Done when:** Automated test fires 11 sign-in attempts from same IP and receives 429 on the 11th; `Retry-After` header present

**S0-AUTH-005** — Build invitation flow
- Agent or Owner can invite users by email, assigning a role
- Invitation creates record in `invitations` table with signed token (hashed SHA-256, not stored in plaintext)
- Invitation email sent via Resend with one-click accept link
- On accept: create auth user if new, create `memberships` record, expire invitation token
- Invitations expire after 7 days
- **Size:** L
- **Blocked by:** S0-DB-001, S0-AUTH-001
- **Done when:** Full invite flow tested end-to-end; expired token returns 410; second use of same token returns 410

**S0-AUTH-006** — Implement role-based middleware
- Next.js middleware reads session and membership role
- Route groups protected: `/dashboard` requires any valid membership, `/settings` requires `owner` or `admin_agent`, `/admin` requires `owner`
- Unauthenticated requests redirect to `/sign-in`
- **Size:** M
- **Blocked by:** S0-AUTH-003, S0-DB-002
- **Done when:** Each protected route returns correct redirect for each role; no protected route is accessible without a valid session

---

### Sprint 0 Gate Checklist

- [ ] All three Supabase environments exist
- [ ] All three R2 buckets exist and are private
- [ ] Upstash Redis provisioned and connected in all environments
- [ ] Vercel preview deploys on PR, production deploys on merge to `main`
- [ ] GitHub Actions CI runs lint, type-check, tests on every PR
- [ ] Codex review fires on every PR
- [ ] Secure headers present on all responses
- [ ] RLS policies in place and test suite passing (including no-RLS-disabled check)
- [ ] Agency registration → invite → accept → sign in flow works end-to-end
- [ ] Brute force protection active on auth endpoints (backed by Redis)
- [ ] Sentry capturing errors with correct environment tag
- [ ] PostHog script absent from DOM before consent

---

## Sprint 1 — Core Product

**Goal:** Talent can upload a video. Agents can watch it and leave timestamped comments. Both see updates in real time. Versions exist.

**Sprint Gate:** An agent invites a talent. Talent uploads a video. Agent opens the player, leaves a point comment and a range comment. Talent sees the comments in real time. Agent resolves a comment. All data is correctly scoped to the agency via RLS.

---

### Upload

**S1-UPLOAD-001** — Build presigned upload flow
- API route generates presigned R2 upload URL via `lib/storage.ts`
- Client uploads directly from browser to R2 — Vercel never handles video bytes
- Multipart upload for files over 50MB
- Validate server-side before issuing presigned URL: content type (MP4, MOV only), file size (max 10GB), container format (must be MP4 or MOV — H.264 codec assumed; full codec-level validation is Post-MVP)
- **Size:** L
- **Blocked by:** S0-INFRA-008, S0-DB-001
- **Done when:** A 2GB MP4 uploads successfully; a file exceeding 10GB is rejected at presign stage with 400; a `.avi` file is rejected with 400

**S1-UPLOAD-002** — Enforce storage quota at upload
- Before issuing presigned URL, check agency's current storage usage against plan limit
- If quota would be exceeded, return 402 with clear message
- Only increment `storage_usage` after confirming object exists in R2 and size is confirmed — not at presign time
- On file delete, atomically decrement `storage_usage`
- **Size:** M
- **Blocked by:** S1-UPLOAD-001
- **Done when:** Agency at quota cannot obtain a presigned URL; usage counter is accurate after upload and delete; aborted uploads do not increment counter

**S1-UPLOAD-003** — Build upload UI
- Drag-and-drop upload zone on dashboard
- Progress bar during upload (reads multipart progress)
- Error state if upload fails with retry option
- Success state navigates to video page
- Mobile: tap to select from camera roll or files
- **Size:** M
- **Blocked by:** S1-UPLOAD-001
- **Done when:** Upload works on desktop (drag-drop) and mobile (tap); progress is visible; errors show retry

**S1-UPLOAD-004** — Implement version upload
- Uploading a new file to an existing video creates a new version record
- Version number increment handled by a Postgres RPC function (`create_video_version`) — not by application logic
- RPC function: locks video row, increments version number, inserts `video_versions` record, returns version number — all within a single transaction
- New version is set as active; previous version remains accessible
- **Size:** M
- **Blocked by:** S1-UPLOAD-001
- **Done when:** Two concurrent upload requests to the same video produce version numbers N and N+1 with no duplicates; verified with concurrent test against the RPC function

---

### Player

**S1-PLAYER-001** — Build video player component
- HTML5 `<video>` element with native controls baseline
- Custom control bar: play/pause, scrub timeline, current time / duration, volume, fullscreen
- Video source is a signed URL fetched from Edge Function — never a direct R2 URL
- Signed URL expires after 15 minutes; player refreshes automatically before expiry
- **Size:** L
- **Blocked by:** S1-UPLOAD-001
- **Done when:** Video plays; signed URL is used (R2 URL never appears in client); URL refreshes without interrupting playback

**S1-PLAYER-002** — Implement comment keyboard shortcuts
- `C` — open comment input at current timestamp
- `I` — set In point for range comment
- `O` — set Out point for range comment
- `X` — clear In/Out points
- Space — play/pause
- Shortcuts disabled when comment input is focused
- **Size:** S
- **Blocked by:** S1-PLAYER-001
- **Done when:** All shortcuts work as specified; shortcuts do not fire when typing in comment input

**S1-PLAYER-003** — Build comment timeline overlay
- Timeline bar shows badge for each comment at its timestamp
- Point comments: circular badge with commenter initials
- Range comments: coloured bar spanning In to Out, badge at In point
- Each user gets a consistent colour derived from their user ID
- Overlapping badges stack; hover reveals all
- **Size:** M
- **Blocked by:** S1-PLAYER-001, S1-COMMENT-001
- **Done when:** Five comments from three users render correctly on timeline; overlapping badges stack and reveal on hover

**S1-PLAYER-004** — Mobile player layout
- Video occupies top half of viewport
- Comment panel occupies bottom half, scrollable
- Persistent comment input bar anchored above comment list
- Tapping timeline seeks and opens comment input at that timestamp
- **Size:** M
- **Blocked by:** S1-PLAYER-001
- **Done when:** Layout correct on 375px and 390px viewport widths; no horizontal scroll; comment input accessible without zooming

---

### Comments

**S1-COMMENT-001** — Build comment data model
- Migration: `comments` table columns: `id`, `video_version_id`, `agency_id`, `user_id`, `content`, `timestamp_seconds`, `end_timestamp_seconds` (nullable), `comment_type` (enum: `point`, `range`), `parent_id` (nullable, self-referential for replies), `resolved` (bool), `resolved_at` (nullable), `resolved_by` (nullable), `deleted_at` (nullable, soft delete), `created_at`
- RLS: agents and talent can read comments on videos they have access to; only comment author can update their own comment; soft delete sets `deleted_at`, does not remove row; hard delete not possible via API
- **Size:** M
- **Blocked by:** S0-DB-001, S0-DB-002
- **Done when:** Migration applies; RLS tests cover all access patterns; hard delete returns error

**S1-COMMENT-002** — Build comment API
- `POST /api/comments` — create comment (point or range)
- `PATCH /api/comments/:id` — edit own comment
- `DELETE /api/comments/:id` — soft delete (sets `deleted_at`); agent can delete any comment in their agency; talent can only delete own
- `GET /api/comments?videoVersionId=` — fetch all non-deleted comments for a version
- All endpoints validate agency membership via RLS
- **Size:** M
- **Blocked by:** S1-COMMENT-001
- **Done when:** All four endpoints return correct responses; soft delete does not remove row; deleted comments excluded from GET; cross-agency access returns 403

**S1-COMMENT-003** — Build comment UI panel
- Comment list sorted by timestamp ascending
- Each comment shows: avatar with consistent colour, name, timestamp badge, content
- Range comments show In/Out timestamps
- Clicking a comment seeks player to that timestamp
- Resolved comments visually distinguished (muted, checkmark)
- Soft-deleted comments show "Comment deleted" placeholder if they have replies, otherwise hidden
- **Size:** M
- **Blocked by:** S1-COMMENT-002, S1-PLAYER-001
- **Done when:** All comment states render correctly; clicking seeks player; resolved state is visually distinct

**S1-COMMENT-004** — Implement real-time comment sync
- Supabase Realtime subscription scoped to `video_version_id` channel only — not agency-wide, not dashboard-wide
- New comments appear in panel without page refresh
- Resolved/deleted state updates in real time
- **Size:** M
- **Blocked by:** S1-COMMENT-002
- **Done when:** Two browser sessions on same video: comment posted in session A appears in session B within 2 seconds without refresh; dashboard page has no Realtime subscription

**S1-COMMENT-005** — Build comment input
- Text input with submit on Enter (Shift+Enter for newline)
- Shows current timestamp when opened via keyboard shortcut
- Shows In/Out timestamps when range mode is active
- Character limit: 2000
- Submit disabled if content is empty
- **Size:** S
- **Blocked by:** S1-COMMENT-002, S1-PLAYER-002
- **Done when:** Input behaves correctly for all states; character limit enforced client and server side

---

### Versioning

**S1-VERSION-001** — Build version selector UI
- Dropdown or tab strip showing all versions for a video: V1, V2, V3…
- Active version highlighted
- Switching version loads that version's file URL and comments
- **Size:** S
- **Blocked by:** S1-UPLOAD-004
- **Done when:** Switching versions changes the video source and comment list; active version is visually indicated

**S1-VERSION-002** — Version history panel
- List of all versions with: version number, upload date, uploader name, file size
- Ability to set any version as active (agent/admin only)
- **Size:** S
- **Blocked by:** S1-VERSION-001
- **Done when:** Version list renders correctly; setting active version updates the video page; talent cannot set active version

---

### Sprint 1 Gate Checklist

- [ ] Talent can upload a video via presigned URL — Vercel never touches video bytes
- [ ] Storage quota enforced atomically at upload; aborted uploads do not inflate counter
- [ ] Container format validated at presign; unsupported formats rejected
- [ ] Concurrent version uploads use Postgres RPC — no duplicate version numbers
- [ ] Video plays via signed URL; direct R2 URL never exposed to client
- [ ] Point and range comments can be created with keyboard shortcuts
- [ ] Comments appear on timeline overlay at correct positions
- [ ] Real-time sync works across two browser sessions; Realtime scoped to video_version_id only
- [ ] Soft delete in place — no hard delete via API
- [ ] Mobile layout correct on 375px viewport
- [ ] All RLS tests still passing

---

## Sprint 2 — Dashboards, Notifications & Guest Links

**Goal:** Agents have a working dashboard. Talent have a working dashboard. Notifications work with batching. Guest links work securely. Plan gates for agent/talent count are in place.

**Sprint Gate:** Agent dashboard shows all talent videos with status. Talent dashboard shows their videos and unread comment count. An agent leaves a comment; talent receives one batched email. A guest link loads the video and comments; direct R2 access is rejected. Adding a 6th agent to a Freemium agency returns 402.

---

### Dashboards

**S2-DASH-001** — Build agent dashboard
- Table/grid of all talent videos in the agency
- Columns: thumbnail, title, talent name, status badge, comment count, last activity, version number
- Filter by status, search by title or talent name
- Bulk status update
- **Size:** L
- **Blocked by:** S1-UPLOAD-003, S1-COMMENT-002
- **Done when:** Dashboard loads all videos for agency; filter and search work; bulk status update applies correctly

**S2-DASH-002** — Build talent dashboard
- Grid of talent's own videos
- Each card: thumbnail, title, status badge, unread comment count
- Clicking card navigates to video page
- **Size:** M
- **Blocked by:** S1-UPLOAD-003
- **Done when:** Talent sees only their own videos; unread comment count is accurate; cross-agency videos not visible

**S2-DASH-003** — Build video status workflow
- Status values: `draft`, `pending_review`, `in_review`, `changes_requested`, `approved`
- Agents can set any status; talent can set `pending_review` only
- Status change recorded in audit log
- Status badge colour-coded throughout UI
- **Size:** M
- **Blocked by:** S2-DASH-001
- **Done when:** All status transitions work with correct permission enforcement; audit log entry created on each change

**S2-DASH-004** — Build PDF export
- Agent can export all comments for a video version as PDF
- PDF contains: video title, version number, export date, list of comments with timestamp, commenter name, content
- Resolved comments visually marked in PDF
- Export triggered server-side, returned as download
- **Size:** M
- **Blocked by:** S1-COMMENT-002
- **Done when:** PDF generates for a video with 50 comments; resolved comments are marked; file downloads correctly on mobile

---

### Plan Gating (Agent & Talent Count)

**S2-GATE-001** — Implement agent and talent count plan gates
- Middleware checks agency's current plan before allowing: adding agents beyond limit, adding talent beyond limit
- Freemium: 1 agent, 5 talent. Starter: 5 agents, 50 talent. Studio: 15 agents, 200 talent. Agency Pro: unlimited.
- Return 402 with clear message when limit would be exceeded
- Storage quota gate remains in Sprint 1 (S1-UPLOAD-002)
- **Size:** M
- **Blocked by:** S0-AUTH-005, S0-INFRA-011
- **Done when:** Adding a 6th agent to a Freemium agency returns 402; adding a 6th talent returns 402; Starter agency can add up to 5 agents

---

### Notifications

**S2-NOTIF-001** — Build notification data model
- Migration: `notifications` table, `notification_preferences` table
- `notifications` columns: `id`, `agency_id`, `recipient_id`, `type`, `video_id`, `comment_id`, `read_at`, `created_at`
- `notification_preferences`: `user_id`, `email_enabled`, `batch_window_minutes` (default 15)
- **Size:** M
- **Done when:** Migration applies; RLS ensures users only read their own notifications

**S2-NOTIF-002** — Implement notification batching
- Notifications are queued, not sent immediately
- A cron job (Vercel cron, every 5 minutes) processes the queue
- Comments posted within the batch window are grouped into one email per recipient
- **Size:** L
- **Blocked by:** S2-NOTIF-001
- **Done when:** 10 comments posted in 2 minutes results in exactly 1 email to the talent; verified with integration test

**S2-NOTIF-003** — Build in-app notification panel
- Bell icon in nav with unread count badge
- Dropdown lists recent notifications with: type, video title, commenter name, timestamp
- Mark as read on click; mark all as read action
- Real-time unread count update via Supabase Realtime
- **Size:** M
- **Blocked by:** S2-NOTIF-001
- **Done when:** New comment creates notification; bell badge increments; clicking notification marks it read and navigates to video at comment timestamp

**S2-NOTIF-004** — Build notification preferences UI
- User can toggle email notifications on/off
- User can set batch window: 5, 15, 30, or 60 minutes
- **Size:** S
- **Blocked by:** S2-NOTIF-001
- **Done when:** Disabling email notifications prevents emails; batch window change takes effect on next queue run

---

### Guest Links

**S2-GUEST-001** — Build guest link data model
- Migration: `guest_links` table: `id`, `video_id`, `video_version_id` (nullable), `token` (hashed SHA-256 — hash stored, plaintext never persisted), `created_by`, `expires_at` (nullable), `revoked_at` (nullable), `view_count`, `last_viewed_at`, `created_at`
- Token is a cryptographically random 32-byte value; fixed length enforced
- **Size:** M
- **Done when:** Migration applies; token column stores hash not plaintext; plaintext token never written to DB or logs

**S2-GUEST-002** — Build guest link API
- `POST /api/videos/:id/guest-link` — generate link (agent only)
- `DELETE /api/videos/:id/guest-link/:linkId` — revoke link
- `GET /api/guest/:token` — public endpoint, validates token, returns video metadata
- Token validation uses constant-time comparison (no timing leak)
- Token is never logged in request logs
- Rate limit: 20 requests per IP per minute on guest endpoint via Upstash Redis
- Revoked or expired tokens return 410
- View count incremented on each valid access
- **Size:** M
- **Blocked by:** S2-GUEST-001, S0-INFRA-011
- **Done when:** Link validates correctly; revoked link returns 410; rate limit tested with 21 rapid requests; view count increments; constant-time comparison used

**S2-GUEST-003** — Build guest playback
- Guest accesses `/guest/:token` — no sign-in required
- Playback URL generated by Edge Function on demand — guest never receives a direct R2 URL
- Comments visible but read-only; no comment input shown
- Guest cannot access any other page or resource
- **Size:** M
- **Blocked by:** S2-GUEST-002
- **Done when:** Guest can play video and read comments; attempting to access `/dashboard` redirects to sign-in; direct R2 URL returns 403

**S2-GUEST-004** — Guest link management UI
- Agent can generate a guest link from the video page
- Optional: set expiry date
- List of active guest links shown with: created date, expiry, view count
- One-click revoke
- **Size:** S
- **Blocked by:** S2-GUEST-002
- **Done when:** Full guest link lifecycle works in UI; revoked link immediately returns 410

---

### Sprint 2 Gate Checklist

- [ ] Agent dashboard loads with correct data scoped to agency
- [ ] Talent dashboard shows only own videos
- [ ] 10 comments in 2 minutes produces 1 batched email
- [ ] In-app notification panel works with real-time updates
- [ ] Guest link tokens are hashed in DB; plaintext never stored or logged
- [ ] Guest playback uses signed URL via Edge Function — direct R2 access rejected
- [ ] Rate limiting active on guest endpoint (Redis-backed)
- [ ] Constant-time comparison used for guest token validation
- [ ] Agent/talent count plan gates enforced; 402 returned correctly
- [ ] PDF export works on mobile
- [ ] All RLS tests still passing

---

## Sprint 3 — Billing, Compliance & Security Hardening

**Goal:** Billing gates work. Agencies cannot exceed their plan. Compliance flows are in place. Security hardening complete before launch.

**Sprint Gate:** A free-tier agency cannot add a sixth agent. A paid agency can. DPA is presented and must be accepted before plan activation. GDPR erasure request anonymises audit log entries. All rate limits are active. Storage reconciliation job runs without errors.

---

### Billing

**S3-BILLING-001** — Configure Stripe
- Create Stripe products and prices: Freemium (free), Starter (£49/month), Studio (£149/month), Agency Pro (£349/month)
- Enable Stripe Tax for UK VAT
- Store `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` in Vercel environment variables — never exposed to client bundle
- **Size:** M
- **Done when:** Products exist in Stripe dashboard; keys set in Vercel and absent from client bundle (verified via build output)

**S3-BILLING-002** — Build Stripe webhook handler
- `POST /api/webhooks/stripe` — receives Stripe events
- Processing order: validate signature → process event → commit to DB → return 200
- Reject requests without valid `Stripe-Signature` header with 400 — do not process
- Handle events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- Idempotent: duplicate events must not create duplicate records (use Stripe event ID as idempotency key)
- Sync subscription state to `agencies` table on each event
- **Size:** L
- **Blocked by:** S3-BILLING-001
- **Done when:** Request with invalid signature returns 400; all four event types update agency state correctly; duplicate event processed only once

**S3-BILLING-003** — Implement full plan feature gates
- Storage quota: already enforced in S1-UPLOAD-002
- Agent/talent count: already enforced in S2-GATE-001
- This task adds: storage hard cap enforcement at plan level, grace period logic
- Soft gate with grace period: on `invoice.payment_failed`, allow 7-day access before restricting
- After grace period, non-payment blocks uploads and new invites (not existing access)
- **Size:** M
- **Blocked by:** S3-BILLING-002
- **Done when:** Grace period allows access for 7 days post-payment failure; access restricted on day 8

**S3-BILLING-004** — Collect legal entity data for invoices
- During plan upgrade: collect agency legal name, billing address, VAT number (optional)
- Store on `agencies` table; pass to Stripe customer metadata
- Fields are required before plan activation completes
- **Size:** M
- **Blocked by:** S3-BILLING-001
- **Done when:** Legal name and address appear on Stripe-generated invoice; plan activation blocked without these fields

**S3-BILLING-005** — Build billing UI
- Settings → Billing page: current plan, usage (agents, talent, storage), next renewal date, payment method
- Upgrade/downgrade via Stripe Customer Portal
- Invoice history via Stripe Customer Portal
- **Size:** M
- **Blocked by:** S3-BILLING-002
- **Done when:** Billing page loads with correct current usage; Customer Portal link works

**S3-BILLING-006** — DPA acceptance gate
- Before activating any paid plan: present Data Processing Agreement
- Agency owner must explicitly accept (checkbox + timestamp recorded)
- Acceptance stored on `agencies` table with timestamp and IP
- Plan activation blocked if DPA not accepted
- **Size:** M
- **Blocked by:** S3-BILLING-001
- **Done when:** Plan upgrade cannot complete without DPA acceptance; acceptance timestamp stored in DB

---

### Compliance

**S3-COMPLY-001** — Build audit log
- Migration: `audit_log` table: `id`, `agency_id`, `actor_id`, `actor_name` (denormalised), `action`, `resource_type`, `resource_id`, `metadata` (JSONB), `created_at`
- Indexes: `audit_log(agency_id)`, `audit_log(created_at)`
- Log events: status changes, version uploads, member invitations, role changes, guest link creation/revocation, billing events
- Entries are immutable — no update or delete via API
- **Size:** M
- **Done when:** All listed event types create audit log entries; entries cannot be modified or deleted via API; indexes present

**S3-COMPLY-002** — Implement right-to-erasure
- `DELETE /api/users/:id/data` — owner or admin can request erasure for a user
- Erasure: delete user's personal data, anonymise audit log entries (replace `actor_name` with "Deleted User", null `actor_id`), revoke all sessions, remove from `memberships`
- Erasure does not delete videos or comments (agency owns this content)
- **Size:** L
- **Blocked by:** S3-COMPLY-001
- **Done when:** After erasure, user cannot sign in; audit log entries show "Deleted User"; personal data not retrievable via API

**S3-COMPLY-003** — Build cookie consent banner
- On first visit, show cookie consent banner
- Necessary cookies (session, auth): always active
- Analytics (PostHog): consent required — script must not load before consent (not just event blocking)
- WebSocket connections (Supabase Realtime): classified as necessary, no consent required
- Consent preference stored in `localStorage`
- **Size:** M
- **Done when:** PostHog script absent from DOM before consent; script loads and events fire only after consent; banner does not reappear after choice made

---

### Security Hardening

**S3-SEC-001** — Implement API rate limiting (full audit)
- Confirm all rate limits are active and Redis-backed:
  - Upload endpoint: 10 requests per user per hour
  - Comment creation: 60 per user per hour
  - Guest link validation: 20 per IP per minute (set in S2-GUEST-002)
  - Auth endpoints: 10 sign-in per IP per 15 min, 5 password reset per IP per hour (set in S0-AUTH-004)
- All return 429 with `Retry-After` header
- **Size:** M
- **Blocked by:** S0-INFRA-011
- **Done when:** Each rate limit tested with automated requests; 429 returned correctly; `Retry-After` header present on all

**S3-SEC-002** — Confirm R2 bucket is fully private
- Verify no public bucket policy exists
- Verify all playback URLs are signed (15-minute expiry)
- Verify guest playback proxies through Edge Function — no direct R2 URL ever returned to client
- Verify CORS policy restricts uploads to app domain
- **Size:** S
- **Done when:** Direct unsigned R2 URL returns 403; guest playback works via signed URL; CORS rejects requests from non-app domains

**S3-SEC-003** — Stripe webhook security audit
- Confirm `Stripe-Signature` header validated on every webhook request
- Confirm idempotency: duplicate events do not create duplicate records
- Confirm Stripe secret key absent from client bundle
- **Size:** S
- **Blocked by:** S3-BILLING-002
- **Done when:** Request without valid signature returns 400; duplicate event processed once; key absent from client bundle

**S3-SEC-004** — Storage reconciliation job
- Nightly cron job recalculates actual R2 storage usage by agency prefix
- Compares to `storage_usage` value in `agencies` table
- If drift exceeds 1MB, logs mismatch to Sentry with agency ID and delta
- Does not auto-correct — flags for manual review
- **Size:** M
- **Blocked by:** S1-UPLOAD-002, S0-INFRA-009
- **Done when:** Job runs without error; a seeded mismatch of 2MB triggers a Sentry alert; job runs nightly via Vercel cron

---

### Sprint 3 Gate Checklist

- [ ] Stripe products created; keys never in client bundle
- [ ] Webhook handler validates signature; processes idempotently; returns 200 after commit
- [ ] Grace period active on payment failure
- [ ] DPA must be accepted before paid plan activates
- [ ] Legal entity data collected and passed to Stripe
- [ ] Audit log created for all listed event types; entries immutable; indexes present
- [ ] Right-to-erasure anonymises audit log; personal data removed
- [ ] Cookie consent gates PostHog script load (not just event firing)
- [ ] All rate limits active, Redis-backed, returning correct headers
- [ ] R2 bucket has no public access; all URLs are signed
- [ ] Storage reconciliation job running and alerting on drift

---

## Sprint 4 — Polish & Launch Prep

**Goal:** The product is accessible, stable, and ready for the first paying customer. PWA installed. All known issues resolved.

**Sprint Gate:** WCAG 2.1 AA audit passes with no critical violations. PWA installs on iOS and Android. Smoke test suite passes against staging. Terms of Service and Privacy Policy are live. First agency can be onboarded end-to-end.

---

### Accessibility

**S4-ACCESS-001** — WCAG 2.1 AA audit
- Run automated audit with Axe on all key pages: sign-in, dashboard, video page, settings, billing
- Fix all critical and serious violations
- Ensure keyboard navigation works throughout: tab order logical, focus visible, no keyboard traps
- **Size:** L
- **Done when:** Axe audit returns zero critical or serious violations on all listed pages

**S4-ACCESS-002** — Screen reader testing
- Test key flows with VoiceOver (iOS/macOS) and NVDA (Windows)
- Player controls, comment list, and comment input must be fully navigable
- **Size:** M
- **Blocked by:** S4-ACCESS-001
- **Done when:** A screen reader user can: play/pause video, read all comments, post a comment, without using a mouse

---

### PWA

**S4-PWA-001** — Configure PWA manifest and service worker
- Web app manifest with name, icons (192px, 512px), theme colour, `display: standalone`
- Service worker: cache shell assets, offline fallback page
- **Size:** M
- **Done when:** Chrome Lighthouse PWA audit passes; app installs on iOS Safari and Android Chrome; offline fallback shows when network is unavailable

---

### Launch Readiness

**S4-LAUNCH-001** — Legal pages
- `/terms` — Terms of Service
- `/privacy` — Privacy Policy listing all subprocessors: Supabase, Cloudflare, Resend, Sentry, PostHog
- `/dpa` — Data Processing Agreement (linked from billing upgrade flow)
- All three pages accessible without sign-in, linked from footer
- **Size:** S
- **Done when:** All three pages exist, linked from footer, accessible without sign-in

**S4-LAUNCH-002** — Smoke test suite
- Automated smoke tests against staging: register agency → invite talent → upload video → leave comment → resolve comment → export PDF → generate guest link → upgrade plan
- Tests run in CI on every merge to `main` targeting staging
- **Size:** L
- **Done when:** Smoke test suite passes against staging with zero failures

**S4-LAUNCH-003** — Production environment validation
- Run smoke test suite against production with a test agency
- Verify Sentry receiving errors from production
- Verify PostHog receiving events from production (post-consent)
- Verify Stripe webhooks delivering to production endpoint
- Verify R2 production bucket is private
- **Size:** M
- **Blocked by:** S4-LAUNCH-002
- **Done when:** All checks pass; test agency deleted after validation

**S4-LAUNCH-004** — Onboarding flow
- First-time agency owner sees a guided checklist: invite your first agent, invite your first talent, upload your first video
- Checklist dismisses when all three are complete
- Returning users do not see checklist
- **Size:** M
- **Done when:** New agency owner sees checklist; checklist dismisses on completion; returning users do not see checklist

---

### Sprint 4 Gate Checklist

- [ ] Axe audit zero critical/serious violations on all key pages
- [ ] Screen reader navigation works for core flows
- [ ] PWA installs on iOS and Android
- [ ] Terms, Privacy Policy, and DPA pages live and linked
- [ ] Smoke test suite passes against staging
- [ ] Production environment validated end-to-end
- [ ] Stripe webhooks verified on production
- [ ] Onboarding checklist works for new agencies

---

## 6.4 Post-MVP Backlog (Not Sprinted)

- Social auth (Google, Microsoft OAuth)
- Comment editing history (`comment_edits` table)
- Mention tagging with `@name` autocomplete
- Comment search and filter by commenter
- Internal admin/support dashboard
- Disaster recovery restore test plan
- Age verification / COPPA (legal review required)
- SSO / SAML
- API access for agencies
- Native mobile app
- HLS adaptive bitrate streaming
- Full codec-level video validation (H.264 enforcement beyond container check)
- Advanced analytics dashboard
- Automated data export for DSAR requests

---

## 6.5 Shared Task List Format (for Agent Execution)

Each task passed to a Claude Code agent must follow this exact structure:

```
TASK_ID: S0-AUTH-002
TITLE: Build registration flow
BRANCH: feat/s0-auth-002-registration
STATUS: not_started
BLOCKED_BY: S0-DB-001, S0-AUTH-001
ACCEPTANCE_CRITERIA:
  - Agency registration form accepts: agency name, owner name, email, password
  - On submit: Supabase auth user created, agencies record created, memberships record created with role=owner
  - User redirected to /dashboard on success
  - End-to-end test passes: register → confirm email → dashboard → memberships row exists with role=owner
  - Invalid inputs show inline validation errors without page reload
NOTES: Use Supabase server client in API route, not client SDK
```

Status values: `not_started` → `in_progress` → `in_review` → `done`

Agents must not begin a task while any `BLOCKED_BY` task is not in `done` status.

---

*End of Section 6 — Sprint Plan v1.2*

*Sections 1–6 complete. Ready for agent execution on Sprint 0.*
