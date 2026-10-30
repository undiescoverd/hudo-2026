# Sprint 5 — Core loop and guest gaps (backlog)

**Status: Backlog (not scheduled)**

**Gate:** Every flow on the agency and guest boards works as drawn in Paper, with the gaps from `docs/flows/inventory.md` closed. Starts only after the Sprint 4 gate passes, per the rule that a new sprint begins from a walkable state.

**Source:** gap issues #159–#171 and #176, filed from the Paper flow boards (Flow 01 core loop, Flow 02 guest link). Ordering follows the dependencies recorded in each task's BLOCKED_BY line.

---

## Tasks

### WAVE 1 — Core review loop (Flow 01)

---

- [ ] **S5-FLOW-001** — Status control on the video page + status-change guards

TASK_ID: S5-FLOW-001
TITLE: Status control on the video page + status-change guards
BRANCH: feat/s5-S5-FLOW-001-status-control-guards
MODEL: sonnet
STATUS: not_started
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

- [ ] **S5-FLOW-002** — Auto-set "In review" on first agent open

TASK_ID: S5-FLOW-002
TITLE: Auto-set "In review" when an agent first opens a Pending review video
BRANCH: feat/s5-S5-FLOW-002-auto-in-review
MODEL: sonnet
STATUS: not_started
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

- [ ] **S5-FLOW-003** — Re-open review when talent uploads to an Approved video

TASK_ID: S5-FLOW-003
TITLE: New version on an Approved video re-opens review
BRANCH: feat/s5-S5-FLOW-003-reopen-on-approved
MODEL: sonnet
STATUS: not_started
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

- [ ] **S5-FLOW-004** — "N open comments on vX" note when viewing a newer version

TASK_ID: S5-FLOW-004
TITLE: Show "N open comments on vX" when viewing a newer version
BRANCH: feat/s5-S5-FLOW-004-open-comments-note
MODEL: sonnet
STATUS: not_started
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

- [ ] **S5-FLOW-005** — Live comment author shows "Unknown" until refresh

TASK_ID: S5-FLOW-005
TITLE: Another user's live comment shows "Unknown" until refresh
BRANCH: fix/s5-S5-FLOW-005-realtime-author
MODEL: sonnet
STATUS: not_started
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

- [ ] **S5-FLOW-006** — Talent unread comment counts never go down

TASK_ID: S5-FLOW-006
TITLE: Opening a video records last_seen_at so unread counts clear
BRANCH: fix/s5-S5-FLOW-006-unread-counts
MODEL: sonnet
STATUS: not_started
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

- [ ] **S5-FLOW-007** — Upload resilience: tab-close warning, part retries, clear Retry

TASK_ID: S5-FLOW-007
TITLE: Upload resilience: tab-close warning, part retries, clear Retry
BRANCH: feat/s5-S5-FLOW-007-upload-resilience
MODEL: sonnet
STATUS: not_started
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

- [ ] **S5-FLOW-008** — Agency label for talent in more than one agency

TASK_ID: S5-FLOW-008
TITLE: Talent dashboard: agency label for talent in more than one agency
BRANCH: feat/s5-S5-FLOW-008-agency-label
MODEL: haiku
STATUS: not_started
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
