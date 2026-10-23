# Handoff: Sprint 4 next steps (written 2026-10-23)

For a fresh chat. Read `CLAUDE.md` first: it owns the build rules, review gates, logging duties and Failure Log. This file owns the **order of work** and the facts a new session can't easily find. Work through the steps top to bottom. Each step ends on a **gate**: the observable condition that means it's done.

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

### 1. Land PR #185
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
- Merge decisions: #177, #175, #173, #158 and #157.
- Top up DeepSeek if he wants the bot reviews back.
- Decide whether to run a live smoke test on staging: a new-version upload exercises 0006, and a reply to a reply exercises 0008's rejection.
- Decisions on #186 (0015 grants migration) and #187 (whether to apply 0004).
