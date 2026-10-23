# Handoff: Sprint 4 next steps (written 2026-10-23, progress updated 2026-10-24)

For a fresh chat. Read `CLAUDE.md` first: it owns the build rules, review gates, logging duties and Failure Log. This file owns the **order of work** and the facts a new session can't easily find. Work through the steps top to bottom. Each step ends on a **gate**: the observable condition that means it's done.

## Resume here (2026-10-24)

| Step | Status |
|---|---|
| 1. Land #185 | ✅ **Done.** Merged as a merge commit (`4cde7a8`). Gate checked. |
| 2. S4-JOURNEY-004 | 🟡 **PR #188 open, CI green, task `in_review`** (sprint file + Linear). Reviews done. **Left:** the signed-in live walk, then Ian's merge, then `orchestrate.js done S4-JOURNEY-004`. See step 2 below. |
| 3. Spec session | 🟡 **Round 1 questions (Q1–Q9) asked, no answers yet.** The questions, recommendations and code facts are under step 3. Don't re-research them. |
| 4. sync-check fix | ⬜ Not started |
| 5. Build the rest | ⬜ Not started |

**Waiting on Ian:**
1. Answers to step 3's Q1–Q9. "Yes to all" accepts the recommendations.
2. Whether to create a staging **admin_agent** user and a **fresh owner sign-up** for the step 2 walk. The seed has only owner, agent and talent. The fresh owner is how to hunt the #175 redirect loop. The alternative is to accept owner, agent and talent only: admin_agent passes the same gates as owner.
3. OK to fix the **pre-existing open redirect** in a separate small PR (`fix/safe-redirect-backslash`). `safeRedirect` (`lib/auth-validation.ts:17`) accepts `?redirect=/\evil.com`, so after sign-in the user lands on evil.com. `app/auth/callback/route.ts:16-20` already rejects `/\`. Fix: reject `\`, control characters and whitespace, or compare `new URL(t, origin).origin`, and add tests.
4. Merge OK for #188 once the walk passes.
5. **Add `CRON_SECRET` to the Vercel Preview env.** Both cron routes return 500 "Server misconfigured" on Preview. Use `printf '%s' "$VAL" | vercel env add CRON_SECRET preview`, never `echo |`.

### Running this from a cloud session (no local machine)
- **Not available in the cloud:** gitignored files (`.env.local`, `.env.staging`, `.env.linear`), `/tmp`, local `node_modules`, the local MCP servers (Supabase, Linear, context7) and Claude memory.
- **Fine in the cloud:** code, reviews, `pnpm install && pnpm build && pnpm test`, `gh` for PRs and checks, and editing tasks and docs.
- **Needs secrets** (configure them in the cloud env, or leave the step for a local session):
  - `orchestrate.js start|review|done` Linear sync needs `LINEAR_API_KEY` in `.env.linear`. Without it the markdown status still changes; run `sync-check` later from a machine with the key.
  - The live walk, `scripts/walk-preview-roles.mjs`, needs `STAGING_SEED_PASSWORD` and a Playwright browser (`pnpm exec playwright install chromium`).
  - `scripts/db-push.sh` (step 5 migrations) needs the DB passwords in `.env.local` / `.env.staging`.
- **Branches:** this doc lives only on `chore/handoff-s4-next-steps` (not on main). The JOURNEY-004 work, plus its SESSIONNOTES entry and the CLAUDE.md Failure Log entry, is on `feat/s4-S4-JOURNEY-004-middleware` (PR #188). Check that branch out to continue step 2.

## Ground rules for this run

- **One branch per step**, always cut from main: `git checkout -b <name> origin/main`. Before the first push, run `git log origin/main..HEAD` and confirm it lists only that step's commits.
- **Ian approves every merge.** Ask in chat, then wait for his yes.
- **Leave `orchestrate.js sync-fix` alone** until step 4 has landed. It currently re-marks four unbuilt tasks as Done (see step 4).
- **No bot reviews.** The DeepSeek-backed checks ("AI Code Review", pullfrog) fail with 402 because the account is out of credit, so the `pr-fix` loop has no review comment to work from. Review with `hudo-security-reviewer` and `pr-review-toolkit:code-reviewer` instead. Note the skipped loop in SESSIONNOTES.

## State at handoff

- **PR #185** (`chore/migration-tracking-repair`) is ready, and its required checks are green.
  - It makes `scripts/db-push.sh` the only way to apply migrations.
  - Tracking on hudo-dev and hudo-staging was repaired to repo versions `0001`… and verified with a schema probe.
  - 0004 is marked applied but isn't live (#187). The 0015 grants follow-up is #186.
- **Linear was tidied today, 2026-10-23:**
  - RES-201, 202 and 203 were set back to Backlog.
  - The old duplicates (RES-74–78 and RES-80) were renamed `[dup of …]` and set to Duplicate.
  - RES-79 (S4-LAUNCH-003) moved to Backlog with no project, as post-alpha work.
  - Project statuses were corrected.
  - Not-started tasks sit in **Backlog**.
  - This tidy isn't in SESSIONNOTES yet; log it in step 4.
- **Open PRs:** #185, #177 (`tasks/sprint-5.md`), #175 (flow inventory), #173, #158 and #157.
- **What's walkable today:** sign-in, upload, play, comment and guest links all work. The review loop can't be completed, because steps 2 and 3 cover what's missing.

## Steps

### 1. Land PR #185 ✅ (done 2026-10-23, merge commit `4cde7a8`)
Ask Ian for the merge OK, merge it, then `git checkout main && git pull`.
**Gate:** `git show main:scripts/db-push.sh` prints the script.

### 2. S4-JOURNEY-004: load the middleware (RES-221)
The spec and acceptance criteria are in `tasks/sprint-4.md` under S4-JOURNEY-004. Use the branch name given there.

Facts for planning:
- `app/middleware.ts` is already complete, but Next 14 only loads a **root** `middleware.ts`, so this code has never run.
- **Public paths:**
  - `PUBLIC_PATHS` already lists `/auth/*` (signin, register, invite, forgot/reset password, callback) and `/guest`.
  - The matcher excludes `api/` entirely, so webhooks and cron pass through because of the matcher, not the path list.
  - Later tasks add public pages that will need adding to this list: `/terms`, `/privacy` and `/dpa` (S4-LAUNCH-001) and `/offline` (S4-PWA-001).
- **Expect breakage:** role gating runs for the first time. Walk every role through the app on a Preview URL before merging: owner, admin_agent, agent, talent, and a guest link. The flow inventory (PR #175) reports an owner redirect loop, which is a likely place for this to break.
- **Mandatory reviews:** this is a security surface. Run `hudo-security-reviewer`, then the code reviewer and the simplifier.
- **Before running `orchestrate.js review`,** commit the status bump (Failure Log: "`review` blocks `gh pr merge`").

**Gate:** every acceptance criterion is ticked, the live Preview check passes for all roles, and Ian has merged it. Then run `orchestrate.js done S4-JOURNEY-004`.

**Progress (2026-10-24): PR #188**, branch `feat/s4-S4-JOURNEY-004-middleware`, Preview `https://hudo-2026-git-feat-s4-s4-journey-a65d5f-info-75594398s-projects.vercel.app`.
- **Built:**
  - `app/middleware.ts` moved to the root with `git mv`. `next build` lists `ƒ Middleware 157 kB`.
  - `/terms`, `/privacy`, `/dpa` and `/offline` were pre-added to `PUBLIC_PATHS` (Ian's call), so LAUNCH-001 and PWA-001 don't need to touch middleware.
  - The matcher excludes `api/`, Next internals and **named** root static files: `/icons/`, `robots.txt`, `sitemap.xml`, `sw.js`, `manifest.webmanifest`. When PWA-001 or LAUNCH-001 adds a different root file, add it to the matcher.
- **Reviews done:**
  - `hudo-security-reviewer`: no blockers or highs. It found the cookie drop on redirect and 403 responses, which is now fixed.
  - Code reviewer: `isForbidden()` replaced `decideAccess()`.
  - 4-angle simplify pass: applied, except reusing `roleAtLeast`, which fails open on unknown roles.
  - An automated scan caught the first extension-based matcher (`/talent/x.png` skipped auth). Fixed.
- **Live checks passed (signed out, curl):**
  - Protected pages return 307 to `/auth/signin?redirect=…`, with the query kept.
  - Auth pages and `/guest/invalid` return 200.
  - A bad guest token goes to `/guest/invalid`.
  - The Stripe webhook POST returns 400 from the app.
  - Cron routes are reached, but return 500 because `CRON_SECRET` is missing on Preview (see Ian's list).
- **Still to do:**
  1. `node --env-file=.env.staging scripts/walk-preview-roles.mjs <preview-url>` (owner, agent, talent and a guest link), plus admin_agent and a fresh owner if Ian approves.
  2. Look for `THREW … ERR_TOO_MANY_REDIRECTS` (a loop), `[FORBIDDEN-PAGE]` or `[ERROR-TEXT]`.
  3. Record the result in the PR and SESSIONNOTES, then ask Ian to merge.
- **Expected and accepted:** a signed-in user with **no** membership gets a plain 403 on `/talent`, because `/dashboard` sends role-less users there. It fails closed. A friendlier page is follow-up work.

### 3. Spec session with Ian: the gate gaps (run alongside step 2)
The Sprint 4 gate (`tasks/sprint-4.md`, line 5) requires "comment/resolve, approve" and a core loop that every role can walk. Three pieces it depends on have no spec anywhere. Question Ian on them with the `grilling` skill, and write no code in this step.

1. **Uploading a new version to an existing video.**
   - The API side exists: `PresignRequestInput.videoId` in `lib/upload-client.ts`, plus the `create_video_version` RPC.
   - No UI sends an existing video's id except the retry path on the upload page.
   - #161 (S5-FLOW-003) assumes this UI exists.
2. **Comment actions: resolve, reply, edit and delete (soft-delete only).**
   - The APIs exist (`app/api/comments/[id]`).
   - `components/comments/CommentItem.tsx` has no actions.
   - Before choosing the delete behaviour, read #187, the Realtime trade-off for soft-delete.
3. **Talent resubmitting after changes are requested.**
   - When a talent upload completes, `app/api/videos/upload/complete/route.ts` moves the video to `pending_review`.
   - So this mostly comes with piece 1. Confirm that with Ian.

For each piece, file a GitHub issue, then add a sprint row. Ian chooses Sprint 4 or Sprint 5; Sprint 5's file lives on PR #177. Create its Linear issue **in the same step**, with a title that starts with the exact task ID (Failure Log: "A markdown task with no Linear issue…").
**Gate:** Ian confirms all three specs, and each one has a GitHub issue, a sprint row and a Linear issue.

**Progress (2026-10-24): the grilling session was started.** Round 1 was asked; Ian hasn't answered yet. Resume by re-posting these questions. Each recommendation is the "yes" answer.

| # | Question | Recommendation |
|---|---|---|
| Q1 | Do all three pieces go in **Sprint 4**? The S4 gate can't pass without them. | Yes, all S4 rows |
| Q2 | Does #159 (status control on the video page, plus guards) **stay out of S4**? The dashboard bulk toolbar already covers "approve" for the gate. | Yes, it stays in S5 |
| Q3 | Is the new-version entry point an **"Upload new version"** button on the video page that opens `/upload?videoId=<id>` (title shown, title and description fields hidden), reusing the upload page's retry and close-tab warning? | Yes |
| Q4 | After the upload, does the user land on the video page with the **new version selected**? | Yes. #162 (the "N open comments on v1" note) stays separate |
| Q5 | Is resubmitting **only** done by uploading a new version (no "re-review without new footage" button)? | Yes |
| Q6 | On a **Changes requested** video, does talent see a banner ("Changes requested. Upload a new version") with the upload button, with the dashboard row linking to it? No new notification type. | Yes |
| Q7 | Are replies **one level** deep, with a Reply button only on top-level comments? This matches 0008. | Yes |
| Q8 | Does a deleted comment that has replies show a **"Comment deleted"** placeholder, while one without replies disappears? | Yes. The current rendering already does this |
| Q9 | For #187, take **option (b)**: keep the live behaviour and add a forward migration that drops the unapplied 0004 filter so CI matches live? | Yes, as its own small task |

**Round 2, still to ask (depends on round 1):**
- Who can resolve or unresolve a comment? The API allows agent and above only, so talent can't. Recommend keeping it that way.
- Edit and delete permissions. The API lets the author edit; talent can delete only their own comments, while agent and above can delete any. Recommend keeping it.
- A reply to a reply currently returns a generic 500 (trigger ERRCODE 23514). Recommend mapping it to a 400 with a clear message.
- An agent uploading a new version sends no notification today. Recommend no new notification for MVP.

**Code facts already gathered (2026-10-24). Don't re-research:**
- **New version:**
  - `presign` accepts an optional `videoId` (talent must own the video).
  - `complete` calls the `create_video_version` RPC, which always sets `active_version_id` to the new version.
  - Only `/upload` exists as an upload UI. It doesn't read searchParams, and it always creates a new video, except on retry.
  - `VersionSelector` auto-selects the newest version. Comments are scoped per `video_version_id`.
- **Status:**
  - When a talent upload completes on a `draft` or `changes_requested` video, it flips to `pending_review` and calls `enqueueUploadNotification`.
  - Agent uploads never change status.
  - `approved` stays as it is; #161 changes that.
  - `canTransition` (`lib/video-status.ts:53`): talent can only set `pending_review`, from `draft` or `changes_requested`.
- **Comments API:**
  - `app/api/comments/[id]` has PATCH and DELETE only.
    - PATCH `content`: author only.
    - PATCH `resolved`: agent and above. It sets `resolved_at` and `resolved_by`.
    - DELETE: soft delete via the admin client. Talent can delete only their own comments; agent and above can delete any.
  - A reply is a POST to `/api/videos/[videoId]/versions/[versionId]/comments` with `parent_id`.
  - The 0008 trigger enforces a maximum depth of 1.
- **Comments UI:**
  - `CommentItem` is display-only. It has no action buttons and renders "[comment deleted]".
  - `CommentThread` nests replies.
  - `CommentInput` always sends `parentId: null`.
  - Guests can't comment.
- **Notifications:** the types are `new_comment`, `comment_resolved`, `status_changed` and `invitation_accepted`. Only `new_comment` (which also covers replies) and `status_changed` (talent upload auto-flip) are sent.

### 4. Fix the `sync-check` false positives
- **Where:** `orchestrate.js`, function `detectGitDrift`. The fallback `git log <release> -F --grep=<TASK_ID>` searches whole commit messages, bodies included.
- **What it trips on:**
  - Plan commit `6b1f049` flags S4-DELETE-001, ERASE-001 and SAVER-001.
  - `77c58d9`, the S1-UPLOAD-001 commit, flags S4-LAUNCH-004 because its body mentions it.
- **Second blind spot:** `cmdSyncCheck` only checks tasks that are in_progress, in_review, done or blocked. A not-started task wrongly marked Done in Linear is never reported.
- **Branch:** `chore/sync-check-false-positives`.
- **Also on this branch:** log the 2026-10-23 Linear tidy in SESSIONNOTES, and update the `orchestrate.md` notes if the behaviour changes.

**Gate:** `node orchestrate.js sync-check` reports none of those four as merged-but-not-done. The new not-started check flags a not-started task that Linear shows as Done. Both rules are covered by a test.

### 5. Build the rest, in queue order
`node orchestrate.js next` picks the order and respects BLOCKED_BY. Build the specs from step 3 where Ian placed them. The remaining Sprint 4 rows:
- S4-LAUNCH-004 (onboarding)
- S4-LAUNCH-001 (legal pages)
- S4-PWA-001 (after JOURNEY-004)
- S4-DELETE-001, then S4-ERASE-001 and S4-SAVER-001
- S4-ACCESS-001
- S4-LAUNCH-002 (staging smoke suite)
- S4-ACCESS-002 (needs a human tester)

**Migrations 0024–0026 (DELETE, ERASE, SAVER):** apply them with `sh scripts/db-push.sh local|staging --dry-run --include-all` first. They need `--include-all` because 0027 is already live. The dry-run must list only the new files.
**Gate:** every Sprint 4 row is `done`, and the Sprint 4 gate text holds on a manual walk through the app as each role.

## Ian's to-do list (bring it up when he's around)
- The 2026-10-24 items are in **Resume here → Waiting on Ian** at the top.
- Merge decisions: #188 (after the walk), #177, #175, #173, #158 and #157.
- Top up DeepSeek if he wants the bot reviews back.
- Decide whether to run a live smoke test on staging: a new-version upload exercises 0006, and a reply to a reply exercises 0008's rejection.
- Decisions on #186 (0015 grants migration) and #187 (whether to apply 0004).
