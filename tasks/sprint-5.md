# Sprint 5 — Core loop and guest gaps (backlog)

**Status: Backlog (not scheduled)**

**Gate:** Every flow on the agency and guest boards works as drawn in Paper, with the gaps from `docs/flows/inventory.md` closed. Starts only after the Sprint 4 gate passes, per the rule that a new sprint begins from a walkable state.

**Source:** gap issues #159–#171 and #176, filed from the Paper flow boards (Flow 01 core loop, Flow 02 guest link). Ordering follows the dependencies recorded in each task's BLOCKED_BY line.

---

## Tasks

### WAVE 1 — Core review loop (Flow 01)

---

- [x] **S5-FLOW-001** — Status control on the video page + status-change guards

TASK_ID: S5-FLOW-001
TITLE: Status control on the video page + status-change guards
BRANCH: feat/s5-S5-FLOW-001-status-control-guards
MODEL: sonnet
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Status control on the video page for owner, admin_agent and agent only, using PATCH /api/videos/:id/status
  - Approve with at least one open comment shows a warning with the count; Confirm proceeds
  - Changes requested with zero open comments is refused, enforced server-side; the bulk toolbar surfaces it per row
  - Moving away from Approved shows a confirm dialog
  - "Changed by {name}, {relative time}" shows on the video page
  - Unit tests for each rule; security review (touches app/api/)
FILES:
  - app/api/videos/[videoId]/status/route.ts (+ test)
  - lib/video-status.ts (+ test)
  - components/dashboard/BulkStatusUpdate.tsx (+ test)
  - app/(dashboard)/videos/[id]/page.tsx
NOTES: GH #159. Paper: Flow 01 steps 05 and 10. Linear RES-204.

---

- [x] **S5-FLOW-002** — Auto-set "In review" on first agent open

TASK_ID: S5-FLOW-002
TITLE: Auto-set "In review" when an agent first opens a Pending review video
BRANCH: feat/s5-S5-FLOW-002-auto-in-review
MODEL: sonnet
STATUS: done
BLOCKED_BY: S5-FLOW-001
ACCEPTANCE_CRITERIA:
  - Owner, admin_agent or agent opening a pending_review video sets it to in_review
  - Talent and guests never trigger it
  - Idempotent; goes through the same transition and audit path as manual changes
  - Realtime status pill and talent dashboard update via the existing subscription
  - Tests for agent, talent and already-in-review cases
FILES:
  - app/(dashboard)/videos/[id]/page.tsx
  - app/api/videos/[videoId]/status/route.ts (+ test)
  - lib/video-status.ts (+ test)
NOTES: GH #160. Paper: Flow 01 step 03. Linear RES-205.

---

- [x] **S5-FLOW-003** — Re-open review when talent uploads to an Approved video

TASK_ID: S5-FLOW-003
TITLE: New version on an Approved video re-opens review
BRANCH: feat/s5-S5-FLOW-003-reopen-on-approved
MODEL: sonnet
STATUS: done
BLOCKED_BY: S5-FLOW-001
ACCEPTANCE_CRITERIA:
  - Talent upload completing on an approved video flips it to pending_review, with the same conditional-update guard as the existing flip
  - The agent upload notification fires for this case
  - Agent uploads never change status
  - Audit log records the flip; tests cover approved to pending_review and the agent-upload no-op
FILES:
  - app/api/videos/upload/complete/route.ts (+ test)
  - lib/video-status.ts (+ test)
  - lib/notifications.ts (+ test)
NOTES: GH #161. Paper: Flow 01 edge case "New version on an approved video". Security review required (app/api/). Linear RES-206.

---

- [x] **S5-FLOW-004** — "N open comments on vX" note when viewing a newer version

TASK_ID: S5-FLOW-004
TITLE: Show "N open comments on vX" when viewing a newer version
BRANCH: feat/s5-S5-FLOW-004-open-comments-note
MODEL: sonnet
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Viewing version N shows one note per earlier version with unresolved, non-deleted comments, with the count
  - Clicking the note switches the player and rail to that version
  - No note when earlier versions have no open comments
  - Works for agents and talent; never shown on the guest page
  - Tests for count and visibility
FILES:
  - components/versions/VersionSelector.tsx (+ test)
  - components/comments/CommentPanel.tsx (+ test)
  - app/api/videos/[videoId]/versions/[versionId]/comments/route.ts (+ test)
NOTES: GH #162. Paper: Flow 01 edge case "v1 still has open comments when v2 lands". Linear RES-207.

---

- [x] **S5-FLOW-005** — Live comment author shows "Unknown" until refresh

TASK_ID: S5-FLOW-005
TITLE: Another user's live comment shows "Unknown" until refresh
BRANCH: fix/s5-S5-FLOW-005-realtime-author
MODEL: sonnet
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - A realtime INSERT from another user shows the correct name and avatar without a refresh
  - No regression to the self-echo merge or UPDATE merge
  - Tests for the other-user INSERT case
FILES:
  - hooks/useVideoComments.ts (+ test)
  - hooks/useRealtimeComments.ts (+ test)
  - lib/comments.ts (+ test)
NOTES: GH #169. See CLAUDE.md Failure Log, Realtime entries. Linear RES-208.

---

- [x] **S5-FLOW-006** — Talent unread comment counts never go down

TASK_ID: S5-FLOW-006
TITLE: Opening a video records last_seen_at so unread counts clear
BRANCH: fix/s5-S5-FLOW-006-unread-counts
MODEL: sonnet
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Opening the video page records comment_reads.last_seen_at for the current user (talent and agents)
  - Talent dashboard unread counts drop to 0 after opening; new comments raise them again
  - RLS: users can only write their own comment_reads rows
  - Tests; security review if a new route is added
FILES:
  - app/(dashboard)/videos/[id]/page.tsx
  - lib/talent-dashboard.ts (+ test)
  - supabase/migrations/ (only if an RLS change is needed; RLS suite updated)
NOTES: GH #168. Prerequisite for S5-FLOW-009. Linear RES-209.

---

- [x] **S5-FLOW-007** — Upload resilience: tab-close warning, part retries, clear Retry

TASK_ID: S5-FLOW-007
TITLE: Upload resilience: tab-close warning, part retries, clear Retry
BRANCH: feat/s5-S5-FLOW-007-upload-resilience
MODEL: sonnet
STATUS: done
BLOCKED_BY: S4-UPLOADFIX-001
ACCEPTANCE_CRITERIA:
  - beforeunload warning while an upload is in progress, removed on finish or failure
  - Each part PUT and the single PUT retry a few times with backoff
  - On final failure the multipart upload is aborted and a clear error with Retry is shown
  - Retry does not create another empty draft (see S4-UPLOADFIX-001)
  - Error display does not mask the real cause
  - Tests for retry, give-up and abort
FILES:
  - hooks/useUpload.ts (+ test)
  - components/upload/UploadProgress.tsx (+ test)
  - lib/storage.ts (+ test)
NOTES: GH #164. Paper: Flow 01 edge case "Upload drops halfway". Related: GH #150. Linear RES-210.

---

- [x] **S5-FLOW-008** — Agency label for talent in more than one agency

TASK_ID: S5-FLOW-008
TITLE: Talent dashboard: agency label for talent in more than one agency
BRANCH: feat/s5-S5-FLOW-008-agency-label
MODEL: haiku
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Talent with more than one agency membership sees the agency name on each row
  - Talent with one agency sees no label
  - No picker or filter is added
  - Tests for single and multi-agency cases
FILES:
  - lib/talent-dashboard.ts (+ test)
  - components/dashboard/TalentDashboard.tsx (+ test)
NOTES: GH #163. Paper: Flow 01 edge case "Talent signed to two agencies". Linear RES-211.

---

### WAVE 2 — Guest review link (Flow 02)

---

- [ ] **S5-GUEST-001** — Guest page: video only, no comments

TASK_ID: S5-GUEST-001
TITLE: Guest page: video only, no comments
BRANCH: feat/s5-S5-GUEST-001-video-only
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - getGuestMetadata no longer queries or returns comments
  - GET /api/guest/:token has no comments field
  - Guest page renders title and player only
  - Tests updated; security review (guest surface)
FILES:
  - lib/guest/get-guest-metadata.ts (+ test)
  - app/api/guest/[token]/route.ts (+ test)
  - app/guest/[token]/page.tsx
  - components/guest/GuestReview.tsx
  - components/guest/GuestComments.tsx (remove)
NOTES: GH #165. Paper: Flow 02 steps 05 and 07. Linear RES-212.

---

- [ ] **S5-GUEST-002** — Guest links: label, expiry presets, auto-hide expired, version indicator

TASK_ID: S5-GUEST-002
TITLE: Guest links: label, expiry presets, auto-hide expired, version indicator
BRANCH: feat/s5-S5-GUEST-002-link-label-expiry
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Migration adds a nullable, length-capped label to guest_links; RLS reviewed; applied to dev and staging via apply_migration
  - Label is never returned on any guest-facing route
  - Modal shows four presets (24 hours, 3 days, 7 days, Never), 3 days preselected; the API still validates expires_at
  - List hides links whose expires_at has passed
  - List shows the pinned version and the older-version nudge; "Share vN instead" creates a new link
  - Tests; security review (app/api/ and migration)
FILES:
  - components/guest/GuestLinkModal.tsx (+ test)
  - components/guest/GuestLinkList.tsx (+ test)
  - app/api/videos/[videoId]/guest-links/route.ts (+ test)
  - supabase/migrations/ (new migration, RLS suite updated)
NOTES: GH #166. Paper: Flow 02 steps 02, 03 and 08. Linear RES-213.

---

- [ ] **S5-GUEST-003** — Guest links stop working when the agency subscription ends

TASK_ID: S5-GUEST-003
TITLE: Guest links stop working when the agency's subscription ends
BRANCH: feat/s5-S5-GUEST-003-links-stop-on-cancel
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - getGuestMetadata and GET /api/guest/:token/playback-url treat links of agencies with subscription_status canceled as invalid, returning the same response as an expired link
  - past_due behaviour unchanged unless decided otherwise (flag in the PR)
  - Links work again if the agency resubscribes; they are not revoked
  - Tests; security review (guest surface)
FILES:
  - lib/guest/get-guest-metadata.ts (+ test)
  - app/api/guest/[token]/playback-url/route.ts (+ test)
  - lib/billing.ts (+ test)
NOTES: GH #167. Paper: Flow 02 edge case "Agency's plan is cancelled". Linear RES-214.

---

- [ ] **S5-GUEST-004** — Notify the agent when a guest watches a shared link

TASK_ID: S5-GUEST-004
TITLE: Notify the agent when a guest watches a shared link
BRANCH: feat/s5-S5-GUEST-004-guest-view-alert
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - First playback on a guest link creates a bell notification for the decided recipients
  - Does not fire again on renewals or reloads (relies on the view-count fix in PR #158)
  - Never exposes guest identity and never puts a token in the payload
  - Recipients decided before build (open question in GH #170)
  - Tests; security review (guest surface and notifications)
FILES:
  - app/api/guest/[token]/playback-url/route.ts (+ test)
  - lib/notifications.ts (+ test)
NOTES: GH #170. Paper: Flow 02 step 08 gap. Do not start until recipients are decided. Linear RES-215.

---

### WAVE 3 — Needs attention list (Flow 01, decision 2026-10-22)

---

- [ ] **S5-FLOW-009** — "Needs attention" list with "seen by" on each video

TASK_ID: S5-FLOW-009
TITLE: Needs attention list with "seen by" on each video
BRANCH: feat/s5-S5-FLOW-009-needs-attention
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: S5-FLOW-006
ACCEPTANCE_CRITERIA:
  - "Needs attention" list shows videos awaiting review for everyone in the agency
  - Each video row shows which agency members have seen it (names, most recent first, with a count when there are many)
  - Opening a video records that the user has seen it
  - A new version resets "seen by"
  - Talent never see "seen by"; guests never see it and no guest route writes a seen record
  - RLS: users can only write their own comment_reads rows
  - Tests for the write, the reset on new version, and the talent and guest exclusions
  - Security review (RLS and a new write path)
FILES:
  - app/(dashboard)/dashboard/page.tsx (+ test)
  - components/dashboard/ (attention strip) (+ test)
  - lib/dashboard.ts (+ test)
  - supabase/migrations/ (only if needed; RLS suite updated)
NOTES: GH #176. Decided 2026-10-22: list name "Needs attention"; talent do not see "seen by". Owner (claim and assign) deferred until an agency asks. Paper boards already renamed. Linear RES-216.

---

### WAVE 4 — Error states (Flow 02 and Flow 01 edge cases)

---

- [ ] **S5-ERR-001** — Design v3 error states: invalid guest link page and video load errors

TASK_ID: S5-ERR-001
TITLE: Design v3 error states: invalid guest link page + video load errors
BRANCH: feat/s5-S5-ERR-001-error-states
MODEL: haiku
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - States drawn in Paper first, then ported
  - Guest player distinguishes 429 from other failures and offers Retry
  - Authed player shows the error state instead of the raw media error
  - Copy uses "comments", never "notes"
  - Tests for the 429 and load-failure states
FILES:
  - app/guest/invalid/page.tsx (+ test)
  - components/guest/GuestPlayer.tsx (+ test)
  - components/player/VideoPlayer.tsx (+ test)
NOTES: GH #171. Paper: both flow boards' edge cases. Linear RES-217.

---

### WAVE 5 — Agency admin (decision 2026-11-21)

---

- [ ] **S5-ADMIN-001** — Owner can grant billing access to admin agents

TASK_ID: S5-ADMIN-001
TITLE: Owner can grant billing access to admin agents
BRANCH: feat/s5-S5-ADMIN-001-billing-access
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Migration 0031 adds memberships.can_manage_billing (boolean, default false); RLS still derives access from memberships
  - Owner sees a per-person billing-access toggle on the team page, offered for admin agents only
  - A granted admin agent sees Billing in the header and can open /settings/billing
  - Granted admin agents can view the plan and invoices and change the payment method (portal); plan change and cancel stay owner-only
  - Billing API routes accept a granted admin agent and reject agents, talent and ungranted admin agents
  - Owner can revoke; it takes effect on the next request
  - Grant and revoke are written to audit_log
  - Unit tests for the permission rule, pgTAP for the column/RLS, route tests; security review (billing + app/api/)
FILES:
  - supabase/migrations/0031_membership_billing_access.sql
  - tests/rls/memberships.test.sql
  - lib/billing-access.ts (+ test)
  - app/api/agencies/[id]/billing/route.ts (+ test)
  - app/api/billing/portal/route.ts (+ test)
  - app/(dashboard)/settings/billing/page.tsx
  - app/(dashboard)/settings/team/page.tsx (+ test)
  - components/settings/BillingAccessToggle.tsx (+ test)
  - components/layout/AppHeader.tsx (+ test)
NOTES: GH #207 (all three open questions decided 2026-11-21). Paper: "Flow · Every role, end to end", admin agent lane, step 08. Needs an API route (or extension of the team route) for the toggle; add it to FILES when planned. Migration 0031: 0024–0026 and 0028 are reserved, 0029 is on main, 0030 is PR #199. Apply with scripts/db-push.sh. Linear RES-228.

---

### WAVE 6 — Talent journey (GH #249, decided and designed 2026-11-24)

Paper: "Hudo App" → **Flow · Talent journey** (read-me map + T3–T8, phone and laptop), plus the updated **Shell & Notifications → AppHeader**, **Screen map** and **Flow · Every role** boards. Agents never upload; only talent do. Build order: NAV-001 first, then NAV-002 / NAV-003 / NAV-006, then NAV-004 → NAV-007 and NAV-005. NOTIF-001 any time.

---

- [ ] **S5-NAV-001** — Every role lands on /dashboard

TASK_ID: S5-NAV-001
TITLE: Every role lands on /dashboard (landing helper, /talent and /videos redirects)
BRANCH: feat/s5-S5-NAV-001-role-landing
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - One helper decides the landing page; /, the sign-in fallback and the logo use it; every role lands on /dashboard
  - An explicit ?redirect= still wins, including after signing in again
  - /dashboard renders the talent Dashboard for talent and the agent dashboard for owner, admin_agent and agent
  - /talent redirects to /dashboard; the old /dashboard → /talent redirect is removed
  - Talent opening exactly /videos go to /dashboard; /videos/[id] still opens for the owning talent (no prefix gate)
  - Unit tests per role, the redirect override, and the /videos vs /videos/[id] split
FILES:
  - lib/landing.ts (+ test)
  - app/page.tsx
  - lib/auth-validation.ts
  - middleware.ts (+ test)
  - app/(dashboard)/dashboard/page.tsx (+ test)
  - app/(dashboard)/talent/page.tsx
  - app/(dashboard)/videos/page.tsx
NOTES: GH #250 (umbrella #249). Closes A1, A5; decisions Q1, Q9, Q11. Paper: Flow · Talent journey T3, T6; Screen map.

---

- [ ] **S5-NAV-002** — Header by role and the talent tab bar

TASK_ID: S5-NAV-002
TITLE: Header by role: no agent Upload, talent Dashboard · Upload + phone tab bar, owner-only Billing
BRANCH: feat/s5-S5-NAV-002-header-by-role
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: S5-NAV-001
ACCEPTANCE_CRITERIA:
  - Agent, admin_agent and owner header: Dashboard · Videos, bell, Billing, Settings, name, Sign out; no Upload
  - Agents below md: logo · bell · menu button; the menu sheet holds Dashboard, Videos, Settings, Billing, Sign out
  - Talent header: Dashboard · Upload, bell, name menu (Settings, Sign out); phones get a Dashboard / Upload bottom tab bar with the active tab highlighted
  - Logo goes to /dashboard; Settings is highlighted on every /settings/* page
  - Billing shows to the owner only (plus a billing-granted admin agent once S5-ADMIN-001 lands)
  - Unit tests for each role's links, the Billing rule and the tab bar's active state
FILES:
  - components/layout/AppHeader.tsx (+ test)
  - components/layout/TalentTabBar.tsx (+ test)
  - components/layout/MobileMenu.tsx (+ test)
  - app/(dashboard)/layout.tsx
NOTES: GH #251 (umbrella #249). Closes A6, E1; decisions Q11, Q12. Paper: Shell & Notifications → AppHeader (updated 2026-11-24); tab bar on Flow · Talent journey T3–T8. S5-ADMIN-001 also edits AppHeader.tsx: whichever lands second rebases and keeps both rules.

---

- [ ] **S5-NAV-003** — Talent Dashboard overview

TASK_ID: S5-NAV-003
TITLE: Talent Dashboard overview: Needs you / With your agent / Approved
BRANCH: feat/s5-S5-NAV-003-talent-dashboard-overview
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: S5-NAV-001
ACCEPTANCE_CRITERIA:
  - Three tiles with counts: Needs you (changes_requested), With your agent (pending_review + in_review), Approved
  - The list below is grouped the same way; each row opens the video page
  - An Upload button on the page whenever the talent has at least one video, as well as in the empty state
  - First visit (no videos): welcome, how it works, one Upload button (T3)
  - Drafts with zero versions are hidden; no "Open to submit" row remains
  - Talent in 2+ agencies keep the agency label on rows (S5-FLOW-008)
  - Unit tests for grouping, counts, hidden drafts and the empty state
FILES:
  - lib/talent-dashboard.ts (+ test)
  - components/dashboard/TalentDashboard.tsx (+ test)
  - components/dashboard/talent/ (tracker, rows, OverviewTiles.tsx) (+ tests)
NOTES: GH #252 (umbrella #249). Closes A2, C1; decisions Q3, Q10. Paper: Flow · Talent journey T3, T6 (phone + laptop).

---

- [ ] **S5-NAV-004** — Talent loop pages

TASK_ID: S5-NAV-004
TITLE: Talent loop: video page status and back link, Sent screen, upload Retry, new-version text
BRANCH: feat/s5-S5-NAV-004-talent-loop
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: S5-NAV-006
ACCEPTANCE_CRITERIA:
  - Video page, talent: status pill; back link goes to the Dashboard (agents' still goes to Videos); Changes requested shows the "Upload a new version" call to action
  - Upload page, talent: a Sent screen after finishing (who it went to, what happens next, back to Dashboard)
  - A failed upload shows a clear error and Retry on the same page
  - New-version text says the video goes back to your agent for review (not "Status stays as it is.")
  - Unit tests for the back link per role, the pill, the Sent and failure states, and the text
FILES:
  - app/(dashboard)/videos/[id]/page.tsx (+ test)
  - app/(dashboard)/upload/page.tsx (+ test)
  - components/upload/UploadProgress.tsx (+ test)
NOTES: GH #253 (umbrella #249). Closes A3, C3, C4; decision Q3 (Retry). Paper: Flow · Talent journey T4, T5, T7.

---

- [ ] **S5-NAV-005** — Talent first run

TASK_ID: S5-NAV-005
TITLE: Talent first run: signed in straight after accepting an invite; sign-in footer copy
BRANCH: feat/s5-S5-NAV-005-talent-first-run
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: S5-NAV-001
ACCEPTANCE_CRITERIA:
  - After accepting an invite the talent is signed in and lands on the Dashboard first visit, with no second sign-in
  - Fallback if auto sign-in isn't possible: sign-in with the email prefilled and ?redirect=/dashboard
  - A talent already signed in who opens an invite is told so and can accept into their account
  - Sign-in footer: "New agency? Create an account" + "Talent: ask your agent for an invite"
  - Unit tests for each path; security review (auth flow)
FILES:
  - app/auth/invite/[token]/page.tsx (+ test)
  - app/api/invitations/accept/route.ts (+ test) (only if sign-in has to happen server-side)
  - app/auth/signin/signin-form.tsx (+ test)
NOTES: GH #254 (umbrella #249). Closes B1, B2, B3; decision Q8. Paper: Flow · Talent journey map T2 → T3; Screens · Sign in and join.

---

- [ ] **S5-NAV-006** — Agents never upload

TASK_ID: S5-NAV-006
TITLE: Agents never upload: server-side talent-only upload; remove the talent picker and agent upload buttons
BRANCH: feat/s5-S5-NAV-006-talent-only-upload
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: S5-NAV-001
ACCEPTANCE_CRITERIA:
  - presign, multipart-url and complete reject any caller who is not a talent member of the agency; an agent-supplied talentId is no longer accepted
  - Upload page: talent picker and "Invite a talent before uploading" state removed; lib/talent-roster.ts deleted, and comment-permissions.ts moves from its isAgentClassRole to lib/roles.ts isAgentPlusRole
  - /upload is talent only in middleware; an agent who opens it goes to /dashboard
  - Video page: "Upload new version" shows only to the owning talent
  - Owner checklist drops the "Upload a video" step (invite agent + invite talent remain)
  - Unit and route tests for each rejection and the checklist; security review (app/api upload routes)
FILES:
  - app/api/videos/upload/presign/route.ts (+ test)
  - app/api/videos/upload/multipart-url/route.ts (+ test)
  - app/api/videos/upload/complete/route.ts (+ tests)
  - app/(dashboard)/upload/page.tsx (+ test)
  - lib/talent-roster.ts (+ test) (delete)
  - components/comments/comment-permissions.ts (+ test) (import isAgentPlusRole from lib/roles.ts instead)
  - app/(dashboard)/videos/[id]/page.tsx (+ test)
  - lib/onboarding-checklist.ts (+ test)
  - components/dashboard/OnboardingChecklist.test.tsx
  - middleware.ts (+ test)
NOTES: GH #255 (umbrella #249). Decision Q12 (2026-11-24): Hudo is review-only for agents. Paper: Flow · Every role (upload column "Review only"); Screen map (/upload · talent only).

---

- [ ] **S5-NAV-007** — Upload agency chooser for talent in 2+ agencies

TASK_ID: S5-NAV-007
TITLE: Upload agency chooser for talent in 2+ agencies
BRANCH: feat/s5-S5-NAV-007-upload-agency-chooser
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: S5-NAV-004
ACCEPTANCE_CRITERIA:
  - Talent in 2+ agencies choose the agency on the upload page; the agency of their most recent video is preselected
  - Talent in one agency see no chooser
  - The unordered .limit(1).single() membership lookup is removed
  - The server checks the caller is a talent member of the chosen agency
  - The video page shows the agency name to talent in 2+ agencies
  - Unit and route tests for one and two agencies, the preselection and a foreign-agency rejection; security review (upload route)
FILES:
  - app/(dashboard)/upload/page.tsx (+ test)
  - app/api/videos/upload/presign/route.ts (+ test)
  - app/(dashboard)/videos/[id]/page.tsx
NOTES: GH #256 (umbrella #249). Closes D1, D3; decision Q5, which reverses the 2026-10-14 "no agency picker" rule (the top-bar agency it relied on was never built). Paper: Flow · Talent journey T4b.

---

- [ ] **S5-NOTIF-001** — Tell talent when their video's status changes

TASK_ID: S5-NOTIF-001
TITLE: Tell talent when their video is Changes requested or Approved (bell + email) or In review (bell)
BRANCH: feat/s5-S5-NOTIF-001-talent-status-alerts
MODEL: sonnet
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Changes requested and Approved: a bell notification plus an email straight away, sent from the status route and awaited; respects notification_preferences.email_enabled
  - The daily digest (batchAndSendNotifications) does not email those rows again
  - In review (S5-FLOW-002's automatic change): bell only
  - Uses the existing status_changed type; no migration
  - The bell panel renders the three messages as drawn on T8; each opens the video
  - Unit and route tests for each status, the preference off and the digest skip; security review (app/api + email)
FILES:
  - app/api/videos/[videoId]/status/route.ts (+ test)
  - lib/notifications.ts (+ test)
  - lib/email-templates/ (status-change template) (+ test)
  - components/notifications/NotificationPanel.tsx (+ test)
NOTES: GH #257 (umbrella #249). Closes C2; decision Q6. Paper: Flow · Talent journey T8.
