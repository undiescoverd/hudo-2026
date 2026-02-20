# Hudo — Product Requirements Document
**Version 1.1**
**Status: Approved — Ready for Agent Execution**
**Last updated: 2026-02-20**

> This document incorporates all changes accepted from the Codex senior technical review. All 14 accepted items are reflected in the relevant sections. Transcoding infrastructure has been removed from scope — direct R2 upload with native HTML5 playback is the confirmed architecture. Section 6 contains the full sprint plan in agent-consumable format.

---

## Table of Contents

1. Product Overview
2. Users & Roles
3. Core Features
4. Data Model
5. Technical Architecture
6. Sprint Plan

---

# Section 1: Product Overview

## 1.1 Purpose

Hudo is a video review platform built specifically for the talent agency and talent relationship. It replaces ad-hoc video sharing via WeTransfer, Dropbox, email, or WhatsApp with a purpose-built review workflow: upload, watch, comment with timestamps, resolve, approve.

The closest reference point is Frame.io, but Hudo is narrower in scope and tighter in focus. It is not a general-purpose creative collaboration tool. It is a workflow tool for agencies managing talent, and for talent submitting work for agency approval.

## 1.2 Problem

Talent agencies currently have no structured way to review video content with their talent. The result is fragmented feedback across platforms, lost comments, no version history, no clear approval state, and no audit trail.

## 1.3 Solution

Hudo provides:

- A secure upload and playback environment for video content
- Timestamped comments — both point comments and range comments — with real-time sync
- A version history so every submission is preserved
- A clear status workflow: draft → pending review → in review → changes requested → approved
- Guest links for sharing with external reviewers without requiring a sign-in
- A notification system with email batching so collaborators are informed without being spammed
- Billing and plan management with storage quotas enforced at upload time

## 1.4 Target Users

**Primary:** UK-based talent agencies with 2–30 agents managing 20–200 talent.

**Secondary:** Talent (individual creators, performers, athletes) submitting video for agency review.

## 1.5 Business Model

SaaS subscription billed monthly. Four tiers:

| Tier | Price | Agents | Talent | Storage |
|---|---|---|---|---|
| Freemium | £0 | 1 | 5 | 5GB |
| Starter | £49/month | 5 | 50 | 50GB |
| Studio | £149/month | 15 | 200 | 200GB |
| Agency Pro | £349/month | Unlimited | Unlimited | 1TB |

UK VAT applies. Stripe Tax handles VAT calculation and collection. Legal entity name, billing address, and VAT number are collected at plan activation for VAT-compliant invoices.

## 1.6 MVP Scope

The MVP includes everything in Sections 2–5 of this document. The post-MVP backlog is defined in Section 6.3.

## 1.7 Out of Scope for MVP

- Comment editing history
- Mention tagging (`@name`)
- Comment search and filter by commenter
- Internal admin/support dashboard
- Disaster recovery restore testing
- Age verification / COPPA compliance
- SSO / SAML
- API access for agencies
- Native mobile app
- HLS adaptive bitrate streaming
- Advanced analytics dashboard
- Automated DSAR data export

---

# Section 2: Users & Roles

## 2.1 Multi-Tenancy Model

Hudo is a multi-tenant SaaS product. Each tenant is an **agency**. All data is isolated by agency. A user can hold memberships at multiple agencies simultaneously — for example, a freelance agent who works across two agencies, or a talent manager who runs their own agency and consults for another.

The multi-tenant model is implemented via a `memberships` table, not via an `agency_id` column on the `users` table. This distinction is critical and must be preserved throughout the data model and all RLS policies.

## 2.2 Roles

### Owner

One per agency. Created automatically when an agency registers. Cannot be removed or transferred via the UI in MVP — requires support intervention. Has all permissions.

### Admin Agent

Appointed by Owner. Can manage agents, talent, and all content. Cannot delete the agency or change billing.

### Agent

Core agency staff. Can manage talent assigned to them, upload videos, leave and resolve comments, generate guest links. Cannot manage other agents or billing.

### Talent

Individuals represented by the agency. Can upload videos (to submit for review), view their own videos, view comments on their videos, leave replies. Cannot access other talent's content.

### Guest

Unauthenticated external reviewer. Accesses a specific video via a signed guest link. Can watch the video and read comments. Cannot post comments. Cannot access any other resource.

## 2.3 Permission Matrix

| Action | Owner | Admin Agent | Agent | Talent | Guest |
|---|---|---|---|---|---|
| Invite agents | ✓ | ✓ | ✗ | ✗ | ✗ |
| Invite talent | ✓ | ✓ | ✓ | ✗ | ✗ |
| Upload video | ✓ | ✓ | ✓ | ✓ | ✗ |
| View any agency video | ✓ | ✓ | ✓ | ✗ | ✗ |
| View own videos | ✓ | ✓ | ✓ | ✓ | ✗ |
| View guest-linked video | ✓ | ✓ | ✓ | ✓ | ✓ |
| Leave comments | ✓ | ✓ | ✓ | ✓ | ✗ |
| Delete any comment | ✓ | ✓ | ✓ | ✗ | ✗ |
| Delete own comment | ✓ | ✓ | ✓ | ✓ | ✗ |
| Resolve comments | ✓ | ✓ | ✓ | ✗ | ✗ |
| Change video status | ✓ | ✓ | ✓ | ✓* | ✗ |
| Generate guest link | ✓ | ✓ | ✓ | ✗ | ✗ |
| Export PDF | ✓ | ✓ | ✓ | ✗ | ✗ |
| Manage billing | ✓ | ✗ | ✗ | ✗ | ✗ |
| View audit log | ✓ | ✓ | ✗ | ✗ | ✗ |
| Request user erasure | ✓ | ✓ | ✗ | ✗ | ✗ |

*Talent can set status to `pending_review` only.

---

# Section 3: Core Features

## 3.1 Authentication & Onboarding

### Agency Registration

A new agency is created by an owner registering with their name, agency name, email, and password. On successful registration:

1. A Supabase auth user is created
2. An `agencies` record is created
3. A `memberships` record is created linking the user to the agency with role `owner`

The owner is redirected to their dashboard with an onboarding checklist: invite your first agent, invite your first talent, upload your first video. The checklist dismisses when all three are complete.

### Invitations

Agents and owners invite new users by email. The invitation system:

- Creates an `invitations` record with a cryptographically random signed token (hashed SHA-256, stored as hash not plaintext)
- Sends an email via Resend with a one-click accept link
- On accept: creates auth user if new to the platform, creates `memberships` record with specified role, expires the token
- Invitations expire after 7 days
- Expired or already-accepted tokens return 410

### Sign-In & Session Management

Email/password authentication via Supabase Auth. Session cookie is set on sign-in and cleared on sign-out. Social auth providers are disabled for MVP.

### Brute Force Protection

- Sign-in: 10 attempts per IP per 15 minutes
- Password reset: 5 requests per IP per hour
- All auth rate limits return 429 with `Retry-After` header

## 3.2 Video Upload

### Upload Flow

Videos are uploaded directly from the browser to Cloudflare R2. Vercel/Next.js never handles video bytes. The flow:

1. Client requests a presigned upload URL from the API
2. API validates: user is authenticated, agency has storage quota remaining, file type and size are within limits
3. API returns presigned URL (for files under 50MB) or multipart upload credentials (for files 50MB and over)
4. Client uploads directly to R2
5. On upload complete, client calls API to confirm — API atomically increments `storage_usage` for the agency and creates the video/version record

### File Constraints

- Maximum file size: 10GB
- Accepted formats: MP4, MOV
- Content type validated server-side before presigned URL is issued

### Storage Quota Enforcement

Storage quota is enforced atomically at upload time, not via background job. Before issuing a presigned URL, the API checks `storage_usage` against the plan limit. If the upload would exceed the limit, the request is rejected with 402. On upload complete, `storage_usage` is incremented atomically. On file delete, `storage_usage` is decremented atomically. Concurrent uploads cannot create a race condition that exceeds quota.

### Versioning

Uploading a new file to an existing video creates a new version. Version numbers are incremented transactionally using `SELECT ... FOR UPDATE` or equivalent to prevent concurrent uploads producing duplicate version numbers. Each version is independently accessible. The active version is the one shown by default.

### Rate Limiting

Upload endpoint: 10 requests per user per hour.

## 3.3 Video Playback

### Player

The video player is built on the HTML5 `<video>` element with a custom control bar. Controls: play/pause, scrub timeline, current time / total duration, volume, fullscreen.

Videos are played back via signed URLs with a 15-minute expiry. The player refreshes the signed URL automatically before expiry without interrupting playback. The direct R2 object URL is never exposed to the client.

### Playback Architecture

All playback URL generation is handled by a Supabase Edge Function or Next.js API route acting as a signing proxy. The client never interacts with R2 directly for playback. This applies to both authenticated users and guests.

### Keyboard Shortcuts

| Key | Action |
|---|---|
| Space | Play / Pause |
| C | Open comment input at current timestamp |
| I | Set In point (range comment) |
| O | Set Out point (range comment) |
| X | Clear In / Out points |

Shortcuts are disabled when a text input is focused.

## 3.4 Comments

### Comment Types

**Point comment:** Anchored to a single timestamp. Created by pressing `C` while the video is paused or playing.

**Range comment:** Anchored to a time range with In and Out points. Created by pressing `I` to set In, `O` to set Out, then `C` to open the comment input.

### Comment Thread Model

Comments can have replies. Replies are stored as comments with a `parent_id` referencing the parent comment. Maximum nesting depth: 1 (replies to replies are not permitted in MVP).

### Comment Resolution

Agents can mark any comment as resolved. Resolved comments remain visible but are visually distinguished. The resolved state, timestamp, and resolver are recorded.

### Soft Delete

Comments are never hard deleted. Deletion sets `deleted_at` on the record. Deleted comments with replies show a "Comment deleted" placeholder. Deleted comments with no replies are hidden from the list. The `deleted_at` field is set by the API — no hard delete is possible via any API endpoint.

### Real-Time Sync

Comments are synced in real time via Supabase Realtime. The subscription is scoped to the `video_version_id` channel. New comments, resolved state changes, and soft deletes propagate to all connected clients viewing the same version within 2 seconds.

### Rate Limiting

Comment creation: 60 per user per hour. Returns 429 with `Retry-After` on limit exceeded.

### Timeline Overlay

The player timeline bar shows a visual badge for each comment:

- Point comments: circular badge with commenter initials at the comment's timestamp
- Range comments: coloured bar spanning In to Out, badge at In point
- Each user gets a consistent colour derived from their user ID
- Overlapping badges stack; hover reveals all

## 3.5 Status Workflow

Videos move through a defined status workflow:

`draft` → `pending_review` → `in_review` → `changes_requested` → `approved`

Talent can set status to `pending_review` only. Agents can set any status. Each status change is recorded in the audit log. Status is displayed as a colour-coded badge throughout the UI.

## 3.6 Dashboards

### Agent Dashboard

- Table or grid of all talent videos in the agency
- Columns: thumbnail, title, talent name, status badge, comment count, last activity, version number
- Filter by status; search by title or talent name
- Bulk status update

### Talent Dashboard

- Grid of the talent's own videos
- Cards show: thumbnail, title, status badge, unread comment count
- Clicking a card navigates to the video page

## 3.7 Notifications

### In-App Notifications

A bell icon in the navigation bar shows an unread count badge. The dropdown lists recent notifications with: type, video title, commenter name, timestamp. Mark as read on click. Mark all as read action. Real-time update via Supabase Realtime.

### Email Notifications

Notifications are batched, not sent per-event. A cron job (Vercel cron, every 5 minutes) processes the notification queue. Comments posted within a user's configured batch window are grouped into a single email per recipient. Default batch window: 15 minutes. Users can configure: 5, 15, 30, or 60 minutes. Users can disable email notifications entirely.

If a collaborator leaves 10 comments in 5 minutes, the recipient receives exactly one email listing all 10 comments — not 10 separate emails.

### Notification Triggers

- New comment on a video you are associated with
- Comment resolved
- Video status changed
- Invitation accepted (for the inviter)

## 3.8 Guest Links

### Generation

Agents generate a guest link for a specific video (and optionally a specific version). The link is a URL containing a cryptographically random token. The token is stored in the database as a SHA-256 hash — the plaintext token is never stored.

Optional: set an expiry date. Agents can revoke a link at any time. View count is tracked per link.

### Access

Guest links are accessible at `/guest/:token` without sign-in. The page shows the video player and comment list in read-only mode. No comment input is shown to guests. No other part of the application is accessible from the guest route.

### Security

- Playback URL is generated by the signing proxy on demand — guests never receive a direct R2 URL
- Rate limit: 20 requests per IP per minute on the guest validation endpoint
- Expired or revoked tokens return 410
- The guest link endpoint does not reveal whether a token exists vs has expired vs has been revoked — it returns 410 in all invalid cases

## 3.9 PDF Export

Agents can export all comments for a video version as a PDF. The PDF contains: video title, version number, export date, and a list of comments with timestamp, commenter name, and content. Resolved comments are visually marked. Export is server-side; the file is returned as a download. Works on mobile via the native share sheet.

## 3.10 Audit Log

The audit log records all significant actions within an agency. Entries are immutable — they cannot be updated or deleted via any API endpoint.

Events logged:

- Video status changes
- Version uploads
- Member invitations sent and accepted
- Role changes
- Guest link creation and revocation
- Billing events (plan upgrades, downgrades, payment failures)

Each entry records: actor ID, actor name (denormalised), action, resource type, resource ID, timestamp, and optional JSONB metadata.

## 3.11 GDPR Compliance

### Right to Erasure

An owner or admin agent can request erasure for any user in their agency. Erasure:

- Deletes the user's personal data from the `users` table
- Anonymises audit log entries: replaces `actor_name` with "Deleted User", nulls `actor_id`
- Revokes all active sessions
- Removes the user from all `memberships` records

Erasure does not delete videos or comments — the agency owns this content.

### Data Processing Agreement

Before activating any paid plan, the agency owner must explicitly accept the Data Processing Agreement. Acceptance is gated — the plan activation cannot complete without it. The acceptance timestamp and IP are stored on the `agencies` record.

### Cookie Consent

A consent banner is shown on first visit. Necessary cookies (session, auth, Supabase Realtime) are always active. Analytics cookies (PostHog) require explicit consent. PostHog does not receive any events before consent is granted. Consent preference is stored in `localStorage` and respected on subsequent visits.

---

# Section 4: Data Model

## 4.1 Multi-Tenancy

All tenant data is isolated via Row Level Security (RLS) on Supabase. Every table with agency-specific data has an `agency_id` column and an RLS policy that scopes reads and writes to the user's current agency memberships.

The user's agency context is established at sign-in. If a user has memberships at multiple agencies, they select their active agency context on sign-in or via a switcher in the navigation.

## 4.2 Tables

### `agencies`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| name | text | Agency display name |
| slug | text | URL-safe identifier, unique |
| plan | text | freemium, starter, studio, agency_pro |
| stripe_customer_id | text | Nullable |
| stripe_subscription_id | text | Nullable |
| subscription_status | text | active, trialing, past_due, canceled |
| storage_usage_bytes | bigint | Atomically maintained |
| storage_limit_bytes | bigint | Set by plan |
| legal_name | text | For VAT invoices |
| billing_address | jsonb | For VAT invoices |
| vat_number | text | Nullable |
| dpa_accepted_at | timestamptz | Nullable |
| dpa_accepted_ip | text | Nullable |
| created_at | timestamptz | |

### `users`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK, matches Supabase auth user ID |
| email | text | Unique |
| full_name | text | |
| avatar_url | text | Nullable |
| created_at | timestamptz | |

No `agency_id` column. Agency membership is determined entirely by the `memberships` table.

### `memberships`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK → users.id |
| agency_id | uuid | FK → agencies.id |
| role | text | owner, admin_agent, agent, talent |
| created_at | timestamptz | |

Unique constraint on `(user_id, agency_id)`.

### `invitations`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| agency_id | uuid | FK → agencies.id |
| invited_by | uuid | FK → users.id |
| email | text | Invitee email |
| role | text | Role to assign on accept |
| token_hash | text | SHA-256 hash of the plaintext token |
| expires_at | timestamptz | 7 days from creation |
| accepted_at | timestamptz | Nullable |
| created_at | timestamptz | |

### `videos`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| agency_id | uuid | FK → agencies.id |
| talent_id | uuid | FK → users.id |
| title | text | |
| status | text | draft, pending_review, in_review, changes_requested, approved |
| active_version_id | uuid | Nullable FK → video_versions.id |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `video_versions`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| video_id | uuid | FK → videos.id |
| agency_id | uuid | FK → agencies.id |
| version_number | integer | Transactionally incremented |
| r2_key | text | Object key in R2 |
| file_size_bytes | bigint | |
| duration_seconds | integer | Nullable, populated post-upload |
| uploaded_by | uuid | FK → users.id |
| created_at | timestamptz | |

### `comments`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| video_version_id | uuid | FK → video_versions.id |
| agency_id | uuid | FK → agencies.id |
| user_id | uuid | FK → users.id |
| content | text | Max 2000 characters |
| comment_type | text | point, range |
| timestamp_seconds | numeric | |
| end_timestamp_seconds | numeric | Nullable, for range comments |
| parent_id | uuid | Nullable, self-referential for replies |
| resolved | boolean | Default false |
| resolved_at | timestamptz | Nullable |
| resolved_by | uuid | Nullable FK → users.id |
| deleted_at | timestamptz | Nullable, soft delete |
| created_at | timestamptz | |

### `notifications`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| agency_id | uuid | FK → agencies.id |
| recipient_id | uuid | FK → users.id |
| type | text | new_comment, comment_resolved, status_changed, invitation_accepted |
| video_id | uuid | Nullable FK → videos.id |
| comment_id | uuid | Nullable FK → comments.id |
| read_at | timestamptz | Nullable |
| created_at | timestamptz | |

### `notification_preferences`

| Column | Type | Notes |
|---|---|---|
| user_id | uuid | PK, FK → users.id |
| email_enabled | boolean | Default true |
| batch_window_minutes | integer | Default 15 |

### `guest_links`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| video_id | uuid | FK → videos.id |
| agency_id | uuid | FK → agencies.id |
| video_version_id | uuid | Nullable FK → video_versions.id |
| token_hash | text | SHA-256 hash of plaintext token |
| created_by | uuid | FK → users.id |
| expires_at | timestamptz | Nullable |
| revoked_at | timestamptz | Nullable |
| view_count | integer | Default 0 |
| last_viewed_at | timestamptz | Nullable |
| created_at | timestamptz | |

### `audit_log`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| agency_id | uuid | FK → agencies.id |
| actor_id | uuid | Nullable (null after erasure) |
| actor_name | text | Denormalised; replaced with "Deleted User" on erasure |
| action | text | e.g. status_changed, version_uploaded |
| resource_type | text | video, comment, membership, etc. |
| resource_id | uuid | |
| metadata | jsonb | Nullable |
| created_at | timestamptz | |

## 4.3 Database Indexes

The following indexes are required for performance at scale. All must be created in the initial migration:

```sql
CREATE INDEX ON memberships (user_id);
CREATE INDEX ON memberships (agency_id);
CREATE INDEX ON video_versions (video_id);
CREATE INDEX ON comments (video_version_id);
CREATE INDEX ON comments (resolved);
CREATE INDEX ON videos (agency_id);
CREATE INDEX ON notifications (user_id);
```

## 4.4 Row Level Security

RLS is enabled on all tables. Policies must enforce:

- Agents can only read and write data belonging to their agency
- Talent can only read data assigned to them
- Guests have no Supabase access — all guest data is served via the signing proxy
- Cross-agency data access is impossible via any direct Supabase query

RLS policies are covered by an automated test suite in `tests/rls/` that runs in CI. Any policy deletion must cause at least one test to fail.

---

# Section 5: Technical Architecture

## 5.1 Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript |
| UI Components | Shadcn UI |
| Auth | Supabase Auth |
| Database | Supabase (PostgreSQL) with RLS |
| Realtime | Supabase Realtime |
| Storage | Cloudflare R2 |
| Email | Resend |
| Payments | Stripe |
| Error monitoring | Sentry |
| Product analytics | PostHog |
| Hosting | Vercel |
| CDN / edge | Cloudflare (via R2 and Vercel Edge) |

## 5.2 Environments

Three environments exist for all infrastructure:

| Environment | Purpose |
|---|---|
| Development | Local and PR preview development |
| Staging | Pre-production integration testing |
| Production | Live product |

Each environment has its own:
- Supabase project
- R2 bucket
- Vercel environment variable group
- Stripe restricted key (dev/staging) or live key (production)

## 5.3 Deployment

- All code lives in a single GitHub repository
- Feature branches are created off `main` using Git worktrees
- PRs trigger Vercel preview deployments
- Merging to `main` deploys to production
- GitHub Actions runs lint, type-check, and tests on every PR
- A Codex review agent runs on every PR and posts a structured review comment
- Branch protection on `main` requires passing CI and at least one approved review

## 5.4 Video Storage Architecture

### Upload

1. Client requests presigned upload URL from `/api/upload/presign`
2. API validates quota, file type, file size
3. For files under 50MB: returns single presigned PUT URL
4. For files 50MB and over: initiates multipart upload, returns part presigned URLs
5. Client uploads directly to R2 — Vercel never handles video bytes
6. Client calls `/api/upload/complete` on finish; API creates DB records and updates storage quota atomically

### Playback

All playback URLs are generated server-side by a signing proxy (Next.js API route or Supabase Edge Function). The signing proxy:

1. Validates the requesting user's access to the video
2. Generates a signed R2 URL with 15-minute expiry
3. Returns the signed URL to the client

The R2 object URL is never returned to the client. The R2 bucket has no public access policy. Unauthenticated requests to R2 return 403.

The player refreshes the signed URL automatically before expiry without interrupting playback.

### R2 Bucket Configuration

- Access: private. No public bucket policy. No public fallback
- CORS: allow uploads from app domain only
- Object versioning: enabled
- Separate buckets per environment

## 5.5 Security Headers

All responses include:

```
Content-Security-Policy: [appropriate policy for app]
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

All session cookies: `SameSite=Lax; Secure; HttpOnly`.

## 5.6 Rate Limiting Summary

| Endpoint | Limit |
|---|---|
| Sign-in | 10 per IP per 15 minutes |
| Password reset | 5 per IP per hour |
| Upload presign | 10 per user per hour |
| Comment creation | 60 per user per hour |
| Guest link validation | 20 per IP per minute |

All rate limited endpoints return 429 with `Retry-After` header on limit exceeded.

## 5.7 Agent Execution Model

Code is written by Claude Code agents. Each agent works on a single task from the sprint plan on a dedicated feature branch. Branches are named `feat/[task-id]-[short-description]`.

A Codex review agent reviews every PR. The review checks: correctness, security, RLS coverage, minimal code principle (only the code needed to function), test coverage, and consistency with this PRD.

Three execution loops govern the build:

**Build Loop:** Agent reads task, implements on feature branch, writes tests, opens PR.

**Review Loop:** Codex reviews PR. If changes required, agent revises. If approved, PR merges to `main`.

**Regression Loop:** After each merge, the full test suite and RLS test suite run against dev. If any test fails, a fix task is created and takes priority over the next sprint task.

No task is started until its dependencies are in `done` status. No sprint begins until the previous sprint passes its gate criteria.

---

# Section 6: Sprint Plan

**Status: Ready for agent execution**

---

## 6.0 Principles

Every task is agent-consumable. Each task has a unique ID, a single owner, a clear definition of done expressed as verifiable acceptance criteria, an estimated size, and explicit blocking dependencies.

Tasks are executed by Claude Code agents working from feature branches off `main`. A Codex review agent reviews every PR. The three loops defined in Section 5.7 govern execution throughout.

Sprint gate criteria apply at the end of each sprint. No sprint begins until the previous sprint has passed its gate.

## 6.1 Task ID Convention

```
[SPRINT]-[AREA]-[NUMBER]
```

Examples: `S0-INFRA-001`, `S1-PLAYER-003`, `S3-BILLING-002`

## 6.2 Task Size Convention

| Size | Time |
|---|---|
| XS | Under 1 hour |
| S | 1–3 hours |
| M | 3–6 hours |
| L | 6–12 hours |
| XL | Full day — split if possible |

---

## Sprint 0 — Infrastructure & Auth

**Goal:** Every environment exists, CI/CD runs, auth works end to end, multi-tenant data model is in place, and the repo is ready for feature development.

**Sprint Gate:** An agent can register a new agency, invite a user, have that user sign in, and be correctly scoped to their agency via RLS. All three Supabase environments exist. Vercel preview deploys on every PR. Main deploys to production on merge.

---

### Infrastructure

**S0-INFRA-001** — Create GitHub repository
- Create repo named `hudo` under company GitHub org
- Add `.gitignore` for Next.js, `.nvmrc` pinned to Node 20
- Add `README.md` with project name and stack summary
- **Done when:** Repo exists, pushes succeed, branch protection on `main` requires PR + passing CI

**S0-INFRA-002** — Initialise Next.js project
- `npx create-next-app@latest` with App Router, TypeScript, Tailwind, ESLint
- Install and configure Shadcn UI
- Delete all placeholder content, confirm clean build
- **Done when:** `npm run build` exits 0 with no errors or warnings

**S0-INFRA-003** — Configure Vercel project
- Connect repo to Vercel, set up preview deploys on PR, production deploy on `main`
- Configure environment variable groups: `development`, `preview`, `production`
- **Done when:** A test PR creates a unique preview URL; merge to `main` deploys to production domain

**S0-INFRA-004** — Create Supabase projects
- Create three Supabase projects: `hudo-dev`, `hudo-staging`, `hudo-prod`
- Store connection strings and anon/service keys in Vercel environment variable groups
- **Done when:** All three projects exist, environment variables are set and accessible in each deployment context

**S0-INFRA-005** — Configure Cloudflare R2
- Create R2 buckets: `hudo-dev`, `hudo-staging`, `hudo-prod`
- Set bucket access to private — no public access, no public fallback
- Configure CORS policy to allow uploads from app domain only
- Enable object versioning on all buckets
- Store R2 credentials in Vercel environment variable groups
- **Done when:** A test file can be uploaded to `hudo-dev` bucket via API key; bucket rejects unauthenticated requests

**S0-INFRA-006** — Set up GitHub Actions CI pipeline
- Lint, type-check, and test on every PR
- Block merge if any check fails
- Add Codex PR review workflow using prompt at `/.github/codex-review-prompt.md`
- **Done when:** A PR with a type error fails CI; a clean PR passes and receives a Codex review comment

**S0-INFRA-007** — Configure secure HTTP headers
- Add `next.config.js` headers: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
- Set `SameSite=Lax; Secure; HttpOnly` on all cookies
- **Done when:** `curl -I` against preview URL returns all required headers; CSP does not block app functionality

**S0-INFRA-008** — Create storage abstraction module
- Create `lib/storage.ts` as the single internal interface for all R2 operations
- Implement: `uploadFile`, `getSignedUrl` (15-minute expiry), `deleteFile`, `checkFileExists`, `initMultipartUpload`, `uploadPart`, `completeMultipartUpload`, `abortMultipartUpload`
- No direct S3 client calls permitted outside this module
- **Done when:** Unit tests cover all eight functions; no other file imports the S3 client directly

**S0-INFRA-009** — Configure Sentry
- Install Sentry SDK, configure for Next.js App Router
- Source maps uploaded on build
- Errors captured in all three environments with environment tag
- **Done when:** A deliberately thrown test error appears in Sentry dashboard with correct environment tag and stack trace

**S0-INFRA-010** — Configure PostHog
- Install PostHog SDK
- Consent-gate all event capture — no events fire until user accepts analytics cookies
- **Done when:** Events appear in PostHog only after cookie consent; no events fire before consent

---

### Database Schema & Multi-Tenancy

**S0-DB-001** — Write base database migration
- Create tables: `agencies`, `memberships`, `users` (no `agency_id` column), `invitations`
- `memberships` columns: `id`, `user_id`, `agency_id`, `role` (enum: `owner`, `admin_agent`, `agent`, `talent`), `created_at`
- Unique constraint on `(user_id, agency_id)`
- Apply migration to `hudo-dev`
- **Done when:** Migration runs without error; `memberships` table exists; `users` table has no `agency_id` column

**S0-DB-002** — Write RLS policies for multi-tenant isolation
- All queries scoped to user's current agency membership
- Agents can only read/write data belonging to their agency
- Talent can only read data assigned to them
- Owner and Admin Agent roles can manage memberships within their agency
- **Done when:** Agent from Agency A cannot read any data from Agency B in a direct Supabase query; verified with RLS test suite

**S0-DB-003** — Write RLS policy test suite
- Create `tests/rls/` directory
- Write automated tests for every RLS policy: correct access granted, cross-agency access denied, talent access scoped correctly, guest access scoped correctly
- Tests run in CI against `hudo-dev`
- **Done when:** All RLS tests pass in CI; any RLS policy deletion causes at least one test to fail

**S0-DB-004** — Create database indexes
- Add all indexes from Section 4.3
- **Done when:** Migration applies cleanly; `EXPLAIN ANALYZE` on key dashboard queries shows index scans, not sequential scans

---

### Auth

**S0-AUTH-001** — Implement Supabase Auth
- Configure Supabase Auth in `hudo-dev`
- Enable email/password provider; disable all social providers
- Configure email templates via Resend for: confirmation, password reset, invitation
- **Done when:** A user can register with email/password and receive a confirmation email via Resend

**S0-AUTH-002** — Build registration flow
- Agency registration page: agency name, owner name, email, password
- On submit: create Supabase auth user, create `agencies` record, create `memberships` record with role `owner`
- Redirect to dashboard on success
- **Done when:** End-to-end test: register → confirm email → land on dashboard → membership record exists with role `owner`

**S0-AUTH-003** — Build sign-in and sign-out
- Sign-in page with email/password
- Supabase session cookie set on success (Secure, HttpOnly, SameSite=Lax)
- Sign-out clears session and redirects to sign-in
- **Done when:** User can sign in, session persists across page refresh, sign-out clears session

**S0-AUTH-004** — Implement brute force protection on auth endpoints
- Rate limit sign-in: 10 per IP per 15 minutes
- Rate limit password reset: 5 per IP per hour
- Return 429 with `Retry-After` header on limit exceeded
- **Done when:** Automated test fires 11 sign-in attempts from same IP and receives 429 on the 11th

**S0-AUTH-005** — Build invitation flow
- Agent or Owner can invite users by email with a specified role
- Creates `invitations` record with hashed token (SHA-256, plaintext never stored)
- Invitation email sent via Resend with one-click accept link
- On accept: create auth user if new, create `memberships` record, expire invitation token
- Invitations expire after 7 days; expired/used tokens return 410
- **Done when:** Full invite flow tested end-to-end; expired token returns 410; second use of same token returns 410

**S0-AUTH-006** — Implement role-based middleware
- Next.js middleware reads session and membership role
- `/dashboard` requires any valid membership; `/settings` requires `owner` or `admin_agent`; `/admin` requires `owner`
- Unauthenticated requests redirect to `/sign-in`
- **Done when:** Each protected route returns correct redirect for each role; no protected route accessible without valid session

---

### Sprint 0 Gate Checklist

- [ ] All three Supabase environments exist
- [ ] All three R2 buckets exist and are private
- [ ] Vercel preview deploys on PR, production deploys on merge to `main`
- [ ] GitHub Actions CI runs lint, type-check, tests on every PR
- [ ] Codex review fires on every PR
- [ ] Secure headers present on all responses
- [ ] RLS policies in place and test suite passing
- [ ] Agency registration → invite → accept → sign in flow works end-to-end
- [ ] Brute force protection active on auth endpoints
- [ ] Sentry capturing errors with correct environment tag

---

## Sprint 1 — Core Product

**Goal:** Talent can upload a video. Agents can watch it and leave timestamped comments. Both see updates in real time. Versions exist.

**Sprint Gate:** Agent invites talent. Talent uploads video. Agent opens player, leaves a point comment and a range comment. Talent sees comments in real time. Agent resolves a comment. All data scoped to agency via RLS.

---

### Upload

**S1-UPLOAD-001** — Build presigned upload flow
- API route generates presigned R2 upload URL via `lib/storage.ts`
- Client uploads directly from browser to R2 — Vercel never handles video bytes
- Multipart upload for files over 50MB
- Validate content type and file size server-side before issuing presigned URL
- Max file size: 10GB. Accepted formats: MP4, MOV
- **Done when:** A 2GB MP4 uploads successfully; a file exceeding 10GB is rejected at presign stage with 400

**S1-UPLOAD-002** — Enforce storage quota at upload
- Check agency's storage usage against plan limit before issuing presigned URL
- If quota would be exceeded, return 402
- On upload complete, atomically increment `storage_usage_bytes`
- On file delete, atomically decrement `storage_usage_bytes`
- **Done when:** Agency at quota cannot obtain a presigned URL; usage counter is accurate after upload and delete

**S1-UPLOAD-003** — Build upload UI
- Drag-and-drop upload zone on dashboard
- Progress bar during upload (reads multipart progress)
- Error state with retry option; success state navigates to video page
- Mobile: tap to select from camera roll or files
- **Done when:** Upload works on desktop (drag-drop) and mobile (tap); progress visible; errors show retry

**S1-UPLOAD-004** — Implement version upload
- Uploading a new file to an existing video creates a new version record
- Version number incremented transactionally (`SELECT ... FOR UPDATE` or equivalent)
- Concurrent uploads cannot produce duplicate version numbers
- New version set as active; previous version remains accessible
- **Done when:** Two concurrent upload requests to same video produce version numbers N and N+1 with no duplicates

---

### Player

**S1-PLAYER-001** — Build video player component
- HTML5 `<video>` element, custom control bar: play/pause, scrub timeline, current time/duration, volume, fullscreen
- Video source is a signed URL fetched from signing proxy — direct R2 URL never exposed to client
- Signed URL expires after 15 minutes; player refreshes automatically before expiry
- **Done when:** Video plays; signed URL used (direct R2 URL never in client); URL refreshes without interrupting playback

**S1-PLAYER-002** — Implement comment keyboard shortcuts
- `C` — open comment input at current timestamp
- `I` — set In point; `O` — set Out point; `X` — clear In/Out points; Space — play/pause
- Shortcuts disabled when comment input is focused
- **Done when:** All shortcuts work; do not fire when typing in comment input

**S1-PLAYER-003** — Build comment timeline overlay
- Timeline bar shows badge for each comment at its timestamp
- Point comments: circular badge with commenter initials
- Range comments: coloured bar spanning In to Out, badge at In point
- Each user gets consistent colour derived from user ID
- Overlapping badges stack; hover reveals all
- **Done when:** Five comments from three users render correctly; overlapping badges stack and reveal on hover

**S1-PLAYER-004** — Mobile player layout
- Video occupies top half of viewport; comment panel occupies bottom half, scrollable
- Persistent comment input bar anchored above comment list
- Tapping timeline seeks and opens comment input at that timestamp
- **Done when:** Layout correct on 375px and 390px viewports; no horizontal scroll; comment input accessible without zooming

---

### Comments

**S1-COMMENT-001** — Build comment data model
- Migration: `comments` table per Section 4.2
- RLS: agents and talent can read comments on videos they have access to; only comment author can edit own comment; soft delete sets `deleted_at`, no hard delete via API
- **Done when:** Migration applies; RLS tests cover all access patterns; hard delete not possible via API

**S1-COMMENT-002** — Build comment API
- `POST /api/comments` — create comment (point or range); validate character limit server-side
- `PATCH /api/comments/:id` — edit own comment
- `DELETE /api/comments/:id` — soft delete; agents can delete any comment in their agency; talent only own
- `GET /api/comments?videoVersionId=` — fetch all non-deleted comments for a version
- **Done when:** All four endpoints return correct responses; soft delete does not remove row; deleted comments excluded from GET; cross-agency access returns 403

**S1-COMMENT-003** — Build comment UI panel
- Comment list sorted by timestamp ascending
- Each comment: avatar with consistent colour, name, timestamp badge, content
- Range comments show In/Out timestamps; clicking seeks player
- Resolved comments visually distinguished; soft-deleted comments show placeholder if they have replies, hidden if not
- **Done when:** All comment states render correctly; clicking seeks player; resolved state visually distinct

**S1-COMMENT-004** — Implement real-time comment sync
- Supabase Realtime subscription scoped to `video_version_id` channel
- New comments, resolved/deleted state changes propagate to all connected clients
- **Done when:** Comment posted in session A appears in session B within 2 seconds without refresh

**S1-COMMENT-005** — Build comment input
- Text input; Enter to submit; Shift+Enter for newline
- Shows current timestamp when opened via keyboard shortcut; shows In/Out when range mode active
- Character limit: 2000; enforced client and server side; submit disabled if empty
- **Done when:** Input behaves correctly for all states; character limit enforced on both sides

---

### Versioning

**S1-VERSION-001** — Build version selector UI
- Dropdown or tab strip showing all versions: V1, V2, V3…
- Active version highlighted; switching loads that version's file and comments
- **Done when:** Switching versions changes video source and comment list; active version visually indicated

**S1-VERSION-002** — Version history panel
- List of all versions: version number, upload date, uploader name, file size
- Ability to set any version as active (agent/admin only)
- **Done when:** Version list renders correctly; setting active version updates video page; talent cannot set active version

---

### Sprint 1 Gate Checklist

- [ ] Talent can upload a video via presigned URL — Vercel never touches video bytes
- [ ] Storage quota enforced atomically at upload
- [ ] Concurrent version uploads produce no duplicate version numbers
- [ ] Video plays via signed URL; direct R2 URL never exposed to client
- [ ] Point and range comments created with keyboard shortcuts
- [ ] Comments appear on timeline overlay at correct positions
- [ ] Real-time sync works across two browser sessions
- [ ] Soft delete in place — no hard delete via API
- [ ] Mobile layout correct on 375px viewport
- [ ] All RLS tests still passing

---

## Sprint 2 — Dashboards, Notifications & Guest Links

**Goal:** Agents have a working dashboard. Talent have a working dashboard. Notifications work with batching. Guest links work securely.

**Sprint Gate:** Agent dashboard shows all talent videos with status. Talent dashboard shows own videos and unread comment count. Agent leaves 10 comments in 2 minutes; talent receives one batched email. Guest link loads video; direct R2 access is rejected.

---

### Dashboards

**S2-DASH-001** — Build agent dashboard
- Table/grid of all talent videos in agency; columns: thumbnail, title, talent name, status badge, comment count, last activity, version number
- Filter by status; search by title or talent name; bulk status update
- **Done when:** Dashboard loads all agency videos; filter and search work; bulk status update applies

**S2-DASH-002** — Build talent dashboard
- Grid of talent's own videos; card: thumbnail, title, status badge, unread comment count
- **Done when:** Talent sees only own videos; unread count accurate; cross-agency videos not visible

**S2-DASH-003** — Build video status workflow
- Status values: `draft`, `pending_review`, `in_review`, `changes_requested`, `approved`
- Agents can set any status; talent can set `pending_review` only
- Status change recorded in audit log; status badge colour-coded throughout UI
- **Done when:** All transitions work with correct permission enforcement; audit log entry created on each change

**S2-DASH-004** — Build PDF export
- Agent exports all comments for a video version as PDF
- PDF contains: video title, version number, export date, comments with timestamp + commenter name + content; resolved comments marked
- Export server-side, returned as download; works on mobile via native share sheet
- **Done when:** PDF generates for 50-comment video; resolved comments marked; downloads correctly on mobile

---

### Notifications

**S2-NOTIF-001** — Build notification data model
- Migration: `notifications` and `notification_preferences` tables per Section 4.2
- **Done when:** Migration applies; RLS ensures users only read own notifications

**S2-NOTIF-002** — Implement notification batching
- Notifications queued, not sent immediately
- Vercel cron (every 5 minutes) processes queue; comments within batch window grouped into one email per recipient
- **Done when:** 10 comments in 2 minutes results in exactly 1 email to talent; verified with integration test

**S2-NOTIF-003** — Build in-app notification panel
- Bell icon with unread count badge; dropdown with recent notifications
- Mark as read on click; mark all as read action; real-time unread count via Supabase Realtime
- **Done when:** New comment creates notification; bell increments; clicking marks read and navigates to video at comment timestamp

**S2-NOTIF-004** — Build notification preferences UI
- Toggle email on/off; set batch window (5, 15, 30, or 60 minutes)
- **Done when:** Disabling email prevents emails; batch window change takes effect on next queue run

---

### Guest Links

**S2-GUEST-001** — Build guest link data model
- Migration: `guest_links` table per Section 4.2
- Token: 32-byte cryptographically random value; SHA-256 hash stored; plaintext never stored
- **Done when:** Migration applies; token column stores hash not plaintext

**S2-GUEST-002** — Build guest link API
- `POST /api/videos/:id/guest-link` — generate link (agent only)
- `DELETE /api/videos/:id/guest-link/:linkId` — revoke
- `GET /api/guest/:token` — public; validates token, returns video metadata
- Rate limit: 20 per IP per minute on guest endpoint; revoked/expired tokens return 410; view count increments on valid access
- **Done when:** Link validates correctly; revoked returns 410; rate limit tested with 21 rapid requests; view count increments

**S2-GUEST-003** — Build guest playback
- `/guest/:token` — no sign-in required
- Playback URL generated by signing proxy on demand — guest never receives direct R2 URL
- Comments visible, read-only; no comment input shown; guest cannot access any other page
- **Done when:** Guest can play video and read comments; accessing `/dashboard` redirects to sign-in; direct R2 URL returns 403

**S2-GUEST-004** — Guest link management UI
- Generate guest link from video page; optional expiry date
- List active guest links: created date, expiry, view count; one-click revoke
- **Done when:** Full guest link lifecycle works in UI; revoked link immediately returns 410

---

### Sprint 2 Gate Checklist

- [ ] Agent dashboard loads with correct agency-scoped data
- [ ] Talent dashboard shows only own videos
- [ ] 10 comments in 2 minutes produces 1 batched email
- [ ] In-app notification panel with real-time updates
- [ ] Guest link tokens hashed in DB; plaintext never stored
- [ ] Guest playback uses signed URL via proxy — direct R2 access rejected
- [ ] Rate limiting active on guest endpoint
- [ ] PDF export works on mobile
- [ ] All RLS tests still passing

---

## Sprint 3 — Billing, Compliance & Security Hardening

**Goal:** Billing gates work. Agencies cannot exceed plan limits. Compliance flows are in place. Security hardening complete before launch.

**Sprint Gate:** Free-tier agency cannot add a sixth agent. Paid agency can. DPA must be accepted before plan activation. GDPR erasure request anonymises audit log. All rate limits active.

---

### Billing

**S3-BILLING-001** — Configure Stripe
- Create products and prices: Freemium (free), Starter (£49/month), Studio (£149/month), Agency Pro (£349/month)
- Enable Stripe Tax for UK VAT
- Store `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` in Vercel environment variables — never in client bundle
- **Done when:** Products exist in Stripe; keys in Vercel; keys never in client bundle (verified with build analysis)

**S3-BILLING-002** — Build Stripe webhook handler
- `POST /api/webhooks/stripe`
- Validate `Stripe-Signature` header on every request — reject without valid signature
- Handle: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- Sync subscription state to `agencies` table on each event
- Idempotent: duplicate events must not create duplicate records
- **Done when:** Handler rejects invalid signature; all four event types update agency state; duplicate event processed once

**S3-BILLING-003** — Implement plan feature gates
- Before allowing: adding agents beyond limit, uploading beyond quota, adding talent beyond limit — check current plan
- Freemium: 1 agent, 5 talent, 5GB. Starter: 5 agents, 50 talent, 50GB. Studio: 15 agents, 200 talent, 200GB. Agency Pro: unlimited, unlimited, 1TB
- Payment failure grace period: 7 days before restricting access
- **Done when:** Adding 6th agent to Freemium agency returns 402; grace period allows access for 7 days post-payment failure

**S3-BILLING-004** — Collect legal entity data for invoices
- During plan upgrade: collect agency legal name, billing address, VAT number (optional)
- Store on `agencies` table; pass to Stripe customer metadata
- Required before plan activation completes
- **Done when:** Legal name and address appear on Stripe invoice; fields required before activation

**S3-BILLING-005** — Build billing UI
- Settings → Billing: current plan, usage (agents, talent, storage), next renewal date, payment method
- Upgrade/downgrade and invoice history via Stripe Customer Portal
- **Done when:** Billing page loads with correct current usage; Customer Portal link works

**S3-BILLING-006** — DPA acceptance gate
- Present Data Processing Agreement before any paid plan activation
- Agency owner must explicitly accept (checkbox); acceptance timestamp and IP stored on `agencies` record
- Plan activation blocked without acceptance
- **Done when:** Upgrade cannot complete without DPA acceptance; timestamp stored in DB

---

### Compliance

**S3-COMPLY-001** — Build audit log
- Migration: `audit_log` table per Section 4.2
- Log: status changes, version uploads, invitations, role changes, guest link creation/revocation, billing events
- Entries are immutable — no update/delete via API
- **Done when:** All listed event types create entries; entries cannot be updated or deleted via API

**S3-COMPLY-002** — Implement right-to-erasure
- `DELETE /api/users/:id/data` — owner or admin agent can request
- Erasure: delete personal data, anonymise audit log (`actor_name` → "Deleted User", `actor_id` → null), revoke all sessions, remove from `memberships`
- Does not delete videos or comments
- **Done when:** After erasure, user cannot sign in; audit log shows "Deleted User"; personal data not retrievable via API

**S3-COMPLY-003** — Build cookie consent banner
- First visit: consent banner
- Necessary (session, auth, Supabase Realtime): always active
- Analytics (PostHog): consent required
- Consent stored in `localStorage`; respected on subsequent visits
- **Done when:** PostHog events do not fire before consent; fire after consent; banner does not reappear after choice

---

### Security Hardening

**S3-SEC-001** — Implement API rate limiting
- Upload endpoint: 10 per user per hour
- Comment creation: 60 per user per hour
- Confirm guest link and auth limits from earlier sprints are active
- All return 429 with `Retry-After`
- **Done when:** Each limit tested with automated requests; 429 returned correctly; `Retry-After` present

**S3-SEC-002** — Confirm R2 bucket fully private
- Verify no public bucket policy
- Verify all playback URLs are signed (15-minute expiry)
- Verify guest playback proxies through signing proxy — no direct R2 URL returned to client
- Verify CORS restricts uploads to app domain
- **Done when:** Direct unsigned R2 URL returns 403; CORS rejects non-app-domain requests

**S3-SEC-003** — Stripe webhook security audit
- Confirm signature validation on every request
- Confirm 200 returned before processing (prevents Stripe retries on slow processing)
- Confirm idempotency for duplicate events
- **Done when:** Request without valid signature returns 400; duplicate event processed only once

---

### Sprint 3 Gate Checklist

- [ ] Stripe products created; keys never in client bundle
- [ ] Webhook handler validates signature on every request
- [ ] Plan gates enforced: Freemium cannot exceed limits
- [ ] Grace period active on payment failure
- [ ] DPA must be accepted before paid plan activates
- [ ] Legal entity data collected and passed to Stripe
- [ ] Audit log entries immutable; all event types logged
- [ ] Right-to-erasure anonymises audit log; personal data removed
- [ ] Cookie consent gates PostHog correctly
- [ ] All rate limits active with correct headers
- [ ] R2 bucket has no public access; all URLs signed

---

## Sprint 4 — Polish & Launch Prep

**Goal:** The product is accessible, stable, and ready for the first paying customer.

**Sprint Gate:** WCAG 2.1 AA audit passes with no critical violations. PWA installs on iOS and Android. Smoke test suite passes against staging. Terms, Privacy Policy, and DPA pages live. First agency can be onboarded end-to-end.

---

### Accessibility

**S4-ACCESS-001** — WCAG 2.1 AA audit
- Axe audit on all key pages: sign-in, dashboard, video page, settings, billing
- Fix all critical and serious violations
- Keyboard navigation: logical tab order, visible focus, no keyboard traps
- **Done when:** Axe audit returns zero critical or serious violations on all listed pages

**S4-ACCESS-002** — Screen reader testing
- Test key flows with VoiceOver (iOS/macOS) and NVDA (Windows)
- Player controls, comment list, and comment input fully navigable
- **Done when:** Screen reader user can play/pause video, read all comments, post a comment without mouse

---

### PWA

**S4-PWA-001** — Configure PWA manifest and service worker
- Web app manifest: name, icons (192px, 512px), theme colour, `display: standalone`
- Service worker: cache shell assets, offline fallback page
- **Done when:** Lighthouse PWA audit passes; app installs on iOS Safari and Android Chrome; offline fallback shows when network unavailable

---

### Launch Readiness

**S4-LAUNCH-001** — Legal pages
- `/terms` — Terms of Service
- `/privacy` — Privacy Policy listing all subprocessors: Supabase, Cloudflare, Resend, Sentry, PostHog
- `/dpa` — Data Processing Agreement
- All accessible without sign-in; linked from footer
- **Done when:** All three pages exist, linked from footer, accessible without auth

**S4-LAUNCH-002** — Smoke test suite
- Automated smoke tests against staging: register agency → invite talent → upload video → leave comment → resolve comment → export PDF → generate guest link → upgrade plan
- Run in CI on every merge to `main` targeting staging
- **Done when:** Smoke suite passes against staging with zero failures

**S4-LAUNCH-003** — Production environment validation
- Run smoke suite against production with test agency
- Verify: Sentry receiving errors, PostHog receiving events post-consent, Stripe webhooks delivering, R2 production bucket private
- Delete test agency after validation
- **Done when:** All checks pass; test agency deleted

**S4-LAUNCH-004** — Onboarding flow
- First-time agency owner sees guided checklist: invite first agent, invite first talent, upload first video
- Checklist dismisses when all three complete; returning users do not see checklist
- **Done when:** New owner sees checklist; dismisses on completion; returning users skip

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

## 6.3 Post-MVP Backlog

Acknowledged, scoped, and deliberately deferred:

- Comment editing history (`comment_edits` table)
- Mention tagging with `@name` autocomplete
- Comment search and filter by commenter
- Internal admin/support dashboard
- Disaster recovery restore test plan
- Age verification / minor handling
- SSO / SAML
- API access for agencies
- Native mobile app
- HLS adaptive bitrate streaming
- Advanced analytics dashboard
- Automated DSAR data export

---

## 6.4 Shared Task Format (for Agent Execution)

Every task passed to a Claude Code agent must follow this structure:

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
  - End-to-end test: register → confirm email → dashboard → memberships row exists with role=owner
  - Invalid inputs show inline validation errors without page reload
NOTES: Use Supabase server client in API route, not client SDK
```

Agents must not begin a task while `BLOCKED_BY` tasks are not in `done` status. Agents update `STATUS` to `in_progress` when starting, `in_review` when pushing PR, `done` when PR is merged.

---

*End of Hudo PRD v1.1*
*Sections 1–6 complete. Ready for Sprint 0 agent execution.*
