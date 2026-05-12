# Hudo — Session Notes

Running log of build events, errors, gotchas, and fixes. Append-only; newest entries at the top. Distil recurring gotchas into `CLAUDE.md → Failure Log` once they're stable.

## Format

See CLAUDE.md → "SESSIONNOTES.md log".

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
