# Hudo — Session Notes

Running log of build events, errors, gotchas, and fixes. Append-only; newest entries at the top. Distil recurring gotchas into `CLAUDE.md → Failure Log` once they're stable.

## Format

See CLAUDE.md → "SESSIONNOTES.md log".

---

## 2026-06-16 — Sprint 2 closeout: final 4 tasks via parallel worktree agents (+ new WIRE-001)

- **Task:** S2-DASH-004, S2-GATE-001, S2-NOTIF-003, S2-NOTIF-004 (Wave 1, parallel) + S2-WIRE-001 (Wave 2, new). Closes S2 to 15/15.
- **Models:** planner/orchestrator=opus; executors=sonnet (DASH-004, GATE-001, NOTIF-003, NOTIF-004 — bumped from haiku as it adds an API route); haiku (WIRE-001).
- **Outcome:** done — PRs #86 (NOTIF-004), #87 (NOTIF-003), #88 (GATE-001), #89 (DASH-004), #90 (WIRE-001) all merged. pdf-lib@1.17.1 added (user-approved) for DASH-004.
- **Notes:**
  - **Parallel isolation via git worktrees.** Disjoint FILES is NOT enough for parallel agents — git's current-branch + working tree are global shared state. Each build agent ran in its own worktree (Agent `isolation: worktree`), symlinking the main repo's `node_modules` as step 0 (worktrees are gitignored-clean → no node_modules → pnpm/type-check/PostToolUse hook all fail without the symlink). Static checks (tsc/eslint) are node-version-agnostic so ran fine on Node 22/25.
  - **Orchestrator owns status, not agents.** Skipped `orchestrate.js start` (it pre-branches in the main dir, which collides with worktrees) and had agents skip `review/done`; main thread ran `done` after each merge. Avoided the known `review`-dirties-sprint-2.md-blocks-merge gotcha entirely.
  - **Three task NOTES were stale and would have caused runtime 500s** if trusted: (1) `notifications` table uses `recipient_id`, but `notification_preferences` uses `user_id` (PK) — different tables, NOTIF-001's "keep recipient_id" note only applied to the former; the NOTIF-004 agent caught this from primary source. (2) GATE-001's "Plan limits live in `plans` table" — NO such table exists; used a static `PLAN_LIMITS` config in lib/plan-gates.ts keyed off `agencies.plan`. Always verify schema claims in NOTES against migrations.
  - **Review chain run from main thread** (code-reviewer + security), not nested in subagents. Found + fixed before merge: NOTIF-003 realtime subscription race (blind 500ms timer → never subscribes on slow auth; made reactive to resolved userId) + panel unread-count computed from capped 50-list; GATE-001 cache fail-open (countSeats returned 0 on DB error and cached it 60s → seat-limit bypass; now returns null, fails closed with `PlanLimitUnavailableError` → 503, never caches errors).
  - **Deferred (logged, not fixed):** GATE-001 check-then-insert TOCTOU — two concurrent adds can both pass the gate and exceed the seat cap. Needs a DB-level atomic count+insert (Postgres RPC/constraint, à la create_video_version), which is out of the task's FILES. File as an S3 hardening task.
- **Gotcha (if any):** (1) `devsecops-security-engineer` subagent died twice on "socket connection closed" (infra flakiness) — did the security review directly from the diffs instead; the mandatory gate was still met. (2) `pnpm add` inside a worktree with symlinked node_modules writes package.json/pnpm-lock into the MAIN repo working tree too — revert those on main (`git checkout -- package.json pnpm-lock.yaml`); they arrive correctly when the feature PR merges. (3) NOTIF-003 realtime needs `ALTER PUBLICATION supabase_realtime ADD TABLE notifications;` at deploy — S1 only added `comments`; without it the unread badge won't update live. (4) GATE-001 `invalidatePlanLimitCache` is exported but must be wired into future plan-change / member-remove handlers.

## 2026-06-16 — Supabase Auth SMTP wired to Resend

- **Task:** Configure Resend SMTP in Supabase Auth (hudo-dev + hudo-staging)
- **Models:** planner=opus, executor=sonnet
- **Outcome:** done
- **Notes:**
  - Applied via Supabase Management API PATCH `/v1/projects/{ref}/config/auth`
  - Both projects: `smtp_host=smtp.resend.com`, port `465`, user `resend`, sender name `Hudo`, from `noreply@resend.com`
  - `smtp_port` must be a **string** (`"465"` not `465`) — API returns 400 otherwise
  - Currently using Resend's shared domain (`noreply@resend.com`) — no custom domain yet
- **Gotcha:** Before production: verify a custom domain in Resend and re-PATCH `smtp_admin_email` + re-apply for both projects. Emails from shared domain may land in spam.

## 2026-06-15 — S2-NOTIF-002 gate closeout (PR #82)

- **Task:** S2-NOTIF-002 pre-merge gates
- **Models:** planner=opus, executor=sonnet
- **Outcome:** done
- **Notes:**
  - `{sent:0,errors:6}` from brief: incorrect — session output was `{sent:0,errors:0}`. Code correctly filters `.is('sent_at', null)`; second run hits early return. Re-run on Node 20 confirmed: step 6 returns `{"sent":0,"errors":0}` ✅
  - Added `.nvmrc` pinning Node 20 (package.json already had `>=20.0.0`). Node 25 causes Upstash incompatibility.
  - Enqueue `.catch()` now logs `{ videoId, commentId: comment.id, err }` — dropped notifications now observable in production logs.
  - Vercel Hobby plan: max once-per-day cron. `0 * * * *` (hourly) failed Vercel deploy just like `*/5`. Fixed to `0 0 * * *` (daily midnight UTC). Cron route comment and ops doc updated.
  - Cron cadence rationale documented in `docs/ops/cron-schedule.md` (Hobby plan = daily max; Pro needed for `*/5`).
  - Security review (devsecops-security-engineer): PASS — LOW severity only. Applied `timingSafeEqual` from `crypto` for constant-time CRON_SECRET comparison. No blocking findings. Three reliability findings deferred (soft-deleted notification rows never stamped; no .limit() on unsent fetch; no per-run email cap) — tracked for S3.
  - Rate-limiter fail-open (lib/redis.ts throws on Redis failure) deferred to S3 — touches multiple routes, widens scope.
  - `pnpm format:check && pnpm type-check && pnpm lint` green on Node 20 ✅
- **Browser walk:** Not completed — `CRON_SECRET` must be added to `.env.local` manually before dev-server test. E2E script test confirmed pipeline on Node 20.
- **Human actions required:**
  1. Add `CRON_SECRET` to Vercel project env vars (all envs). Until set, deployed cron returns 500 — no emails sent in production.
  2. Approve and merge PR #82 once CI is green.
- **Gotcha:** `*/5` inside a JSDoc block comment (`/** ... */`) is parsed as end-of-comment by Prettier → SyntaxError. Workaround: write "every-5-min cadence" instead of literal cron syntax in JSDoc comments.
- **Gotcha:** `new Resend('')` throws at module load time — Next.js "Collecting page data" build step imports route modules, triggering the constructor and crashing the CI build when `RESEND_API_KEY` is absent. Fixed by lazy-instantiating inside `sendEmail()`.
- **Gotcha:** `pull_request: synchronize` events stopped firing for PR #82 after close/reopen burst. Added `workflow_dispatch` to `ci.yml` and manually triggered to unblock. ✅ CI green on run 27527132283.

---

## 2026-06-15 — S2-NOTIF-002 notification batching

- **Task:** S2-NOTIF-002
- **Models:** planner=opus, executor=sonnet
- **Outcome:** done
- **Notes:**
  - Shipped: `lib/email-templates/comments-batch.tsx` (HTML digest template), `lib/notifications.ts` (`enqueueCommentNotification` + `batchAndSendNotifications`), `app/api/cron/notifications/route.ts` (CRON_SECRET-gated GET), `vercel.json` cron entry (`*/5 * * * *`). Wired enqueue into comment POST route.
  - 11 tests pass: 5 lib/notifications unit tests + 6 cron route source-invariant tests.
  - End-to-end pipeline validated via `scripts/playwright-notif-test.mts`: 3 comments → 3 unsent notification rows targeting recipient (not author) → 1 digest email → all `sent_at` stamped → idempotent second run returns `{sent:0,errors:0}`.
- **Browser walk:** Cron endpoint not tested via browser (requires `CRON_SECRET` in `.env.local` — add manually). Pipeline validated via direct script test above.
- **Gotcha:** `batch_window_minutes` check constraint only allows `IN (5, 15, 30, 60)` — cannot set 0 for testing. Workaround: backdate notification `created_at` to 6+ min ago before calling batchAndSend in the test script.
- **Gotcha:** Node v25.3.0 incompatible with Upstash Redis auto-pipeline (`res.map is not a function`) — rate limiter fails-closed → 429 on all comment POST calls. Workaround for testing: insert comments directly into DB via admin client, bypassing the API route.

---

## 2026-05-17 — S2 walkable-MVP guest-link path: GUEST-002/003/004 stacked PRs

- **Task:** S2-GUEST-002 (PR #79), S2-GUEST-003 (PR #80, base #79), S2-GUEST-004 (PR #81, base #80). Plus chore PR #78 (quota logging + dev CSP).
- **Models:** planner=opus, executors: sonnet (002+003), haiku (004). Reviewers: pr-review-toolkit:code-reviewer + devsecops-security-engineer for 002+003; code-simplifier on 002.
- **Outcome:** done. Walkable agent MVP: create guest link → external viewer plays + sees comments → revoke → 404. Manual browser walkthrough still pending — see PR #81 test plan.
- **Notes:**
  - GUEST-002 ships 4 routes + migration 0015 (`increment_guest_link_view` RPC for atomic view count, applied to hudo-dev + hudo-staging via MCP). Security review flagged the read-modify-write race; fixed via the RPC. 59 unit tests pass.
  - GUEST-003 initially did a server-side self-`fetch()` of its own API route to derive baseUrl from headers. Both reviewers flagged host-header injection risk. Fixed by extracting the lookup to `lib/guest/get-guest-metadata.ts` and calling it in-process from `page.tsx`. Also added Sentry `beforeBreadcrumb`/`beforeSend` scrubbers so the plaintext token can never reach Sentry via breadcrumbs even from a previously-consented browser profile.
  - GUEST-004 wired a Share button into `app/(dashboard)/videos/[id]/page.tsx`. Inline Tailwind modal (no shadcn Dialog primitive in repo). Plaintext token shown once + Copy with brief "Copied!" flip.
  - PR stack: rebase the bases as each one merges.
- **Gotcha:** Server-side `fetch()` of a same-origin API route from a Next app-router page tempts you to compute baseUrl from `headers()`. That's a host-header SSRF / token-exfil hole unless `NEXT_PUBLIC_BASE_URL` is enforced. Prefer extracting the data-fetch into a `lib/` helper and calling it in-process. Bonus: token no longer hits Vercel access logs.
- **Gotcha:** The repo has no `pnpm test` script. Tests run via `cd <test-dir> && npx tsx --test route.test.ts` (the `[bracket]` path chars break globs from the repo root). They're source-pattern-match tests, not handler-execution tests — useful but weaker than integration tests.

---

## 2026-05-13 — Schema backfill round 2: dev/staging migration sync complete

- **Task:** Bring hudo-dev + hudo-staging fully in sync with `supabase/migrations/0004–0014` after round 1 (storage_quota_rpcs) cleared `/api/videos/upload/complete`. Round 2 unblocks the next 500: PATCH `/api/videos/[id]` failing on missing `description` column.
- **Models:** planner=opus, executor=opus (single-session MCP applies)
- **Outcome:** done. All three audit booleans (`has_thumb`, `has_desc`, `has_comment_reads`) = true on both projects.
- **Notes:**
  - Audit (verified via Supabase MCP, not SESSIONNOTES claims):

    | #    | Migration                   | dev                   | staging               |
    | ---- | --------------------------- | --------------------- | --------------------- |
    | 0004 | RLS comments soft-delete    | trust ✓               | trust ✓               |
    | 0005 | invitations RLS docs        | n/a                   | n/a                   |
    | 0006 | RPC caller validation       | function SECDEF ✓     | function SECDEF ✓     |
    | 0007 | storage quota RPCs          | applied (round 1)     | applied (round 1)     |
    | 0008 | comments nesting + realtime | column ✓              | column ✓              |
    | 0009 | videos.thumbnail_r2_key     | **applied (round 2)** | **applied (round 2)** |
    | 0010 | SECDEF soft-delete fix      | trust ✓               | trust ✓               |
    | 0011 | videos.description          | **applied (round 2)** | **applied (round 2)** |
    | 0012 | notifications batched email | columns ✓             | columns ✓             |
    | 0013 | guest links indexes         | trust ✓               | trust ✓               |
    | 0014 | comment_reads               | table ✓               | **applied (round 2)** |

  - Applied via MCP `apply_migration` (so `supabase_migrations.schema_migrations` now tracks them) — no SQL editor pastes.
  - dev `list_migrations` now shows: initial_schema, rls_policies, rls_fix_memberships_recursion, storage_quota_rpcs, videos_thumbnail_r2_key, videos_add_description.
  - staging adds `comment_reads` to that list.

- **Gotcha:** Round 1 fixed the upload, but the _next_ user step (save title/description) hit the same class of bug — confirms that "schema cache miss" errors arrive one-per-column, one-per-route. When backfilling, audit the _whole_ migration range, not just the column the user complained about.
- **Out of scope (flagged):** verify 0006 caller-validation `IF p_uploaded_by != auth.uid()` block is in the live `create_video_version` body; full `supabase db diff` for trust-only entries (0004/0010/0013); Upstash `res.map` rate-limiter bug; `app/middleware.ts` location.

---

## 2026-05-12 — S2 Wave 2 closeout: GUEST-001 + DASH-002 + DASH-003 shipped

- **Task:** S2-GUEST-001 (PR #73), S2-DASH-002 (PR #75), S2-DASH-003 (PR #76) merged. The agent-reviews-talent-video walkable loop is now live.
- **Models:** planner=opus, executor=sonnet for all three; reviewers=pr-review-toolkit:code-reviewer + devsecops-security-engineer.
- **Outcome:** done. Sprint-2: 6/14 (SHELL, DASH-001, DASH-002, DASH-003, NOTIF-001, GUEST-001).
- **Notes:**
  - **GUEST-001**: `lib/guest-tokens.ts` (32-byte base64url tokens, sha-256 hex hash, timing-safe verify via `crypto.timingSafeEqual` with length-guard) + migration 0013 (CREATE INDEX only on existing `guest_links`). Security review approved with two LOW notes for the future GUEST-002 API layer (cap token length to 43 chars before calling verify; consuming endpoint should also validate).
  - **DASH-002**: `/talent` dashboard with VideoCard grid + unread comment count. New migration 0014 `comment_reads` table with RLS policies scoped by both `user_id = auth.uid()` AND a `videos → memberships` join — CodeRabbit caught the missing tenant scope on first push; implementer fixed before review. Security review confirmed the tenant-scope fix is correct and noted the belt-and-braces interaction: the EXISTS subquery selects from `videos`, triggering `videos_select_talent` RLS, which means a talent in the same agency can't write a comment_read for someone else's video. Defense-in-depth working.
  - **DASH-003**: `PATCH /api/videos/[id]/status` with `canTransition()` matrix in `lib/video-status.ts`. Service-role client used for audit_log + video update. Audit-first ordering (audit insert → video update; if audit fails, abort; if video update fails after audit, log `auditOrphan: true`). BulkStatusUpdate wired and enabled, max 20 per batch.
  - Security review forced one round of fixes on DASH-003: added per-user rate limit (in addition to IP), bulk-apply cap = 20, structured `auditOrphan: true` log field for the rare orphan path.
- **Walkable journey — NOT verified in browser this session.** Per the 2026-05-11 Failure Log rule ("Ship walkable flows, not component piles") AND CLAUDE.md ("For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete"), the agent→/dashboard→bulk-set in_review→talent→/talent→see status flow has only been validated via code review + CI green. The dev server was not run; no clicks were performed; no test accounts were exercised against dev Supabase. The user (or next session) must walk this before treating the loop as ship-confirmed. Specifically remaining: (a) sign in as agent role, (b) confirm `/dashboard` renders talent videos with status/talent/comment columns, (c) select 2 rows, set `in_review`, click Apply, (d) verify 200 from PATCH + `router.refresh` re-fetches, (e) verify audit_log row inserted, (f) sign in as talent, confirm `/talent` shows the new status. Path-mismatch spot-check: `BulkStatusUpdate` POSTs to `/api/videos/${id}/status`; route file is `app/api/videos/[videoId]/status/route.ts` — Next.js routes by file position so this works, but a 200 on the first bulk-apply is the cheapest confirmation.
- **Gotcha (deferred — track for follow-up):**
  - DASH-003 handler tests are source-string greps via `assert.match`, not true integration tests. Real coverage gap: a regression that drops the audit insert call but keeps the error string would pass current tests. Track as a follow-up "DASH-003 handler integration tests" task.
  - DASH-003 audit + video update are non-atomic — orphan audit row possible if video update fails after audit insert. CLAUDE.md already mandates "Version numbers via Postgres RPC … to prevent race conditions" — same pattern should apply here. Track as a follow-up "status_changed via Postgres RPC for atomicity" task; defer to S3 hardening.
  - `actor_name` in audit_log is user-mutable display name. Audit evidence must reference `actor_id` (UUID), not `actor_name`. Add to compliance docs in S3.

---

## 2026-05-12 — S2 Wave 2 phase: DASH-001 + NOTIF-001 shipped

- **Task:** S2-DASH-001 (PR #71) + S2-NOTIF-001 (PR #72) merged together as opening salvo of Wave 2.
- **Models:** planner=opus, executor=sonnet (DASH-001), executor=haiku (NOTIF-001); reviewers=pr-review-toolkit:code-reviewer + devsecops-security-engineer.
- **Outcome:** done. 2/14 → 4/14 sprint progress (including SHELL).
- **Notes:**
  - DASH-001 ships shared `lib/video-status.ts` + `lib/auth-helpers.ts` for DASH-002/DASH-003 to reuse, agent dashboard at `/dashboard`, API `/api/dashboard/videos`, shadcn `table/badge/checkbox/select/input/card` added.
  - `BulkStatusUpdate.tsx` button shipped permanently disabled with `TODO(S2-DASH-003)` per the planner contract.
  - Security review forced a follow-up: `getCurrentUserRole` originally returned the union of all `agency_ids` even when caller was only talent in some — RLS rescued reads but the pattern would break the first write-path reuse. Fix split returned shape into `{ agency_ids, agent_agency_ids }`. DASH-003 must consume `agent_agency_ids` for any mutating endpoint.
  - Also added ilike metacharacter escaping + 200-char `q` cap on the dashboard search.
  - NOTIF-001 = pure `ALTER ... ADD COLUMN IF NOT EXISTS` + 3 indexes on `notifications`/`notification_preferences`. Idempotent, no RLS touched.
- **Gotcha:** `pnpm test` doesn't exist at top-level — `package.json` only has `test:e2e`. Unit tests run via `npx tsx --test <file>`. CI evidently runs differently (lint/type/build pass; RLS tests pass; no separate unit test job). Worth wiring `"test": "node --test --import tsx 'lib/**/*.test.ts'"` later; for now executors should use the per-file invocation.

---

## 2026-05-11 — S2-SHELL-001: app shell shipped

- **Task:** S2-SHELL-001 — app shell, video list, root redirect (PR #69)
- **Models:** planner=opus, executor=opus (light glue), tests verified manually
- **Outcome:** done, merged to main
- **Notes:**
  - Added `app/(dashboard)/layout.tsx` server layout that fetches user + highest role from `memberships` and renders `<AppHeader>`.
  - `app/page.tsx` now redirects: signed-in → `/videos`, signed-out → `/auth/signin`.
  - `safeRedirect()` default moved from `/` → `/videos`; updated `app/api/auth/signin/route.test.ts` expectations to match.
  - Video list (`app/(dashboard)/videos/page.tsx`) is a server component querying RLS-scoped videos; status badges inline (no Shadcn).
  - Back link added to video detail page so the flow is round-trippable.
  - Unblocked: DASH-001/002/004, GATE-001, NOTIF-001, GUEST-001.
- **Gotcha:** `orchestrate.js review` mutates `tasks/sprint-2.md` locally even after the branch was pushed; if you then try to `gh pr merge` from the feature branch, git refuses to checkout because of the uncommitted change. Fix: `git stash` before merging, or commit the status bump before running review. The `done` step on `main` re-writes the status anyway.

---

## 2026-05-11 — S2 replan: app shell first

- **Task:** Roll back NOTIF-001 start; add S2-SHELL-001 (app shell); re-order S2 waves.
- **Models:** planner=opus, executor=opus (sprint file + CLAUDE.md edits only)
- **Outcome:** done
- **Notes:** Discovered S1 shipped no connective tissue (no layout, no nav, no video list, no root redirect). NOTIF-001/GUEST-001 deprioritised to wave 3. SHELL-001 added as solo wave 1 gating everything.
- **Gotcha (if any):** Always run a local walkthrough before declaring a sprint done. The S1 gate was deferred and revealed structural gaps only visible in a browser.

---

## 2026-05-11 — S2 wave 1 kickoff (housekeeping PR + plan correction)

- **Task:** Land sprint-1 closeout chore (workflow rule + sprint files + housekeeping) on branch `chore/sprint-1-closeout`; correct sprint-2 migration scope before NOTIF-001/GUEST-001 kickoff.
- **Models:** planner=opus, executor=opus (chore + sprint-2 edits — docs/config only, no code path)
- **Outcome:** done (PR #67 open); S2 wave-1 kickoff (NOTIF-001 + GUEST-001) **halted pending user signoff** on revised migration scope.
- **Notes:** Three commits on the chore branch — workflow + sprint files; gitignore (`supabase/.branches/`, `supabase/.temp/`); docs vault + design file. `images/image.png` left untracked (no code refs, but auto-mode forbids deletion without confirmation). PR #67 opened with checklist for Vercel Preview + S1 manual gate. `pnpm format:check && pnpm type-check && pnpm lint` all green pre-push.
- **Gotcha (if any):** **Sprint-2.md NOTIF-001/GUEST-001 acceptance criteria as originally drafted assumed greenfield CREATE TABLE migrations, but `notifications` / `notification_preferences` / `guest_links` already exist in `0001_initial_schema.sql` with RLS in `0002`.** Migrations are ALTER + CREATE INDEX only. Existing column is `recipient_id` not `user_id` — RLS in 0002 already references it; do NOT rename. Sprint-2 acceptance criteria rewritten in this PR to match. Always grep existing migrations before drafting new ones.

---

## 2026-05-10 — Sprint 1 close-out + Sprint 2 kickoff

- **Task:** Archive sprint-1 (17/17 done), seed `tasks/sprint-2.md` with all 13 S2 tasks (Dashboards, Plan Gating, Notifications, Guest Links).
- **Models:** planner=opus, executor=opus (mechanical task-file generation only)
- **Outcome:** done
- **Notes:** Moved `tasks/sprint-1.md` → `tasks/archive/sprint-1.md`. Created `tasks/sprint-2.md` mirroring sprint-1 structure: per-task TASK_ID/BRANCH/MODEL/STATUS/BLOCKED_BY/ACCEPTANCE_CRITERIA/FILES blocks. Sprint Gate copied verbatim from `tasks/sprints-all.md`. Model assignments per CLAUDE.md sizing: M→sonnet (default), S/XS→haiku, L (DASH-001, NOTIF-002)→sonnet with code-review gate flagged in NOTES. Security-sensitive tasks (NOTIF-001, GUEST-001/002/003) flagged for mandatory devsecops-security-engineer review. `node orchestrate.js next` confirms wave 1: DASH-001, DASH-002, DASH-004, GATE-001, NOTIF-001, GUEST-001.
- **Gotcha (if any):** Orchestrator only loads non-archived sprint files, so cross-sprint `BLOCKED_BY: S1-*` / `S0-*` entries surface as "unknown dep" and leave tasks stuck even when those deps are done. Convention: only list intra-sprint deps in `BLOCKED_BY`; record cross-sprint context in `NOTES` instead. Mirrors how `sprint-1.md` handled S0 deps.

---

## 2026-05-10 — Workflow rule + session log bootstrap

- **Task:** Establish Opus-plans / Sonnet-or-Haiku-executes / review-chain workflow rule, create SESSIONNOTES.md, add Stop-hook reminder.
- **Models:** planner=opus, executor=opus (workflow doc + hook only — pure config, no code path)
- **Outcome:** done
- **Notes:** Added `## Model & Workflow Rule` section to CLAUDE.md after Agent Rules. Created this file. Merged a `Stop` hook into `.claude/settings.json` that prints a `systemMessage` if `.ts/.tsx/.sql/.js` files changed but SESSIONNOTES.md was not modified. Existing PreToolUse / PostToolUse hooks left untouched.
- **Gotcha (if any):** Stop hook uses `;` not `&&` between commands — `&&` breaks the chain when `grep` finds no match (exit 1) and the reminder never fires.

---

## 2026-05-12 22:00 — Dev environment debugging

- **Task:** Fix localhost:3000 startup errors and apply pending migrations
- **Models:** executor=sonnet
- **Outcome:** partial
- **Notes:** Fixed CSP (added unsafe-eval for dev HMR, EU PostHog domains to script-src/connect-src). Applied migrations 0004–0013 via Supabase SQL editor. Migration 0009 (thumbnail_r2_key) still pending — user needs membership+agency seed data to test upload flow.
- **Gotcha (if any):** Hook output (⎿ Stop says...) bleeds into SQL when user copies from Claude Code response — always write SQL to scripts/ file instead of inline code blocks.

---

## 2026-05-13 12:35 — Storage-quota RPC missing in hudo-dev/staging (PGRST202)

- **Task:** Fix `/api/videos/upload/complete` 500 — diagnosed as PGRST202 "Could not find function public.increment_storage_usage" in `/tmp/hudo-dev.log`.
- **Models:** planner=opus, executor=opus (DB-only ops via Supabase MCP, no code path)
- **Outcome:** done (root cause); follow-ups noted below
- **Notes:**
  - Verified via Supabase MCP: hudo-dev's `pg_proc` had `create_video_version` + `get_current_user_agency_ids` but **not** `increment_storage_usage`/`decrement_storage_usage`. hudo-staging same gap, plus `comment_reads` table missing (0014).
  - `supabase_migrations.schema_migrations` tracks only 0001–0003 on dev — confirming SESSIONNOTES 2026-05-12's "Applied migrations 0004–0013 via Supabase SQL editor" only updated schema, not the tracking table. So 0007 was likely paste-applied but at some point the storage RPCs were dropped/never landed.
  - Applied `0007_storage_quota_rpcs.sql` to both dev (`xyeqnjboqimvhdwnyqbt`) and staging (`egabjtxrrcuzooyclwgw`) via MCP `apply_migration` — both now tracked in `schema_migrations` as `storage_quota_rpcs`. Verified functions present with signature `(uuid, bigint)`.
  - **No application code changes.** Round-1 edits in dirty tree (`lib/storage-quota.ts` predicate broadening, structured log in `route.ts:194`, `lib/supabase-server.ts`, `next.config.js`) are unrelated to this fix and stay as they are for their own PR.
- **Gotcha (if any):** **PGRST202 = the function is missing from PostgREST's schema cache, almost always because the migration wasn't applied to that project.** Verify with `mcp__plugin_supabase_supabase__execute_sql` against `pg_proc` before assuming a code bug. Bonus trap: `components/upload/UploadProgress.tsx` matches any error string containing `"quota"` and shows the friendly over-quota panel — broad matcher hid the real failure. `MEMORY.md`'s "0001–0003 applied" note was stale and reinforced the misdiagnosis; updated.
- **Follow-ups (out of scope, file as tasks):**
  - hudo-staging missing `comment_reads` table (migration 0014). Apply before staging hits 0014-dependent code paths.
  - Upstash Redis pipeline `TypeError: res.map is not a function` at top of `/tmp/hudo-dev.log` — caught by rate limiter so requests proceed unrate-limited. Real bug.
  - `app/middleware.ts` location — Next.js expects middleware at the project root; verify it's being invoked.
  - Audit other `MEMORY.md` "applied" claims; the SQL-editor-vs-MCP tracking gap means any project's actual migration state should be verified via `list_migrations` + `pg_proc` probes, not memory.
