# Hudo — Session Notes

Running log of build events, errors, gotchas, and fixes. Append-only; newest entries at the top. Distil recurring gotchas into `CLAUDE.md → Failure Log` once they're stable.

## Format

See CLAUDE.md → "SESSIONNOTES.md log".

---

## 2026-07-02 — Live smoke test PASSED on preview (post-#131 code)

- **Task:** live-smoke-test walkthrough (per `.claude/skills/live-smoke-test/SKILL.md`) on the `chore/audit-run-wrapup` preview, covering all 16 merged audit PRs.
- **Models:** planner=fable (drove Playwright MCP directly).
- **Outcome:** done — all steps pass. Sign-in (owner@hudo.test) → `/videos`; `/dashboard` renders both seed videos with statuses/comment counts; crown-jewel `55c07ab0…` plays (`readyState 4`, `error null`, signed `hudo-staging` R2 URL, `currentTime` 0→2.16s); comment thread + input mounted AND the new #129 CommentTimeline marker renders on the seek bar; guest link minted → guest page plays (`readyState 4`, 0→2.19s) + comments render + view-count RPC incremented ("Views: 1") → link revoked → token returns 404. Console clean of `media-src` violations on both authed + guest pages (only the benign vercel.live preview-feedback CSP block + favicon 404).
- **Gotcha (if any):** **A paused (INACTIVE) Supabase project surfaces as "Invalid email or password" (401) on sign-in** — hudo-staging had auto-paused from inactivity, and the first smoke-test attempt looked like a credentials bug. Check `get_project` status (or the dashboard) before debugging auth against staging after idle periods; MCP `execute_sql` also just times out ("Connection terminated") on a paused project.

## 2026-07-02 — Codebase improvement plan: 16 PRs (#115–#131) across security/CI/UX/refactor waves

- **Task:** Full execution of the approved codebase-improvement plan (audit → 4 waves). Wave 1 security: S3-SEC-005 privilege escalation (#119), S3-SEC-001 fail-closed rate limiting (#123), S3-SEC-003 webhook retry contract (#120), S3-SEC-006 Sentry wiring + PII scrub (#122). Wave 2 CI: unit tests into CI (#117+#121), pre-push build hook (#118), RLS 12/12 (#124). Wave 3 UX: comment-panel error state (#126), dashboard boundaries (#127), a11y (#125). Wave 4: supabase-admin extraction (#130), dead-code sweep (#128), CommentTimeline wiring (#129), route-helper consolidation (#131).
- **Models:** planner=fable, executors=sonnet (features/security) + haiku (mechanical); gates=hudo-security-reviewer ×5 + rls-tenancy-auditor ×1.
- **Outcome:** done — all PRs merged green; S3-SEC-001/003/005/006 Done in Linear (RES-70/72/197/198).
- **Notes:** The Sentry gate rejected #122 TWICE and was right both times: (1) bare `captureException` still ships full request context (guest token in url, sb-access-token cookie, POST body) via requestDataIntegration defaults — empirically reproduced; (2) after the `beforeSend` scrub fix, transaction events (tracesSampleRate 0.1) bypass `beforeSend` entirely — the leak was PRE-EXISTING for ~10% of requests to token routes. Fix: `scrubSentryEvent` wired to BOTH `beforeSend` and `beforeSendTransaction` on both runtimes, token+code URL redaction. Also: #117 was accidentally merged before its Node-22 fix (a `;` instead of `&&` between watch and merge in an automation chain — repo doesn't enforce required checks on admin merges); hotfixed in #121 within minutes.
- **Gotcha (if any):** Three distilled to the Failure Log: node:test glob needs Node 21+ (CI was 20); `.gitignore` `node_modules/` doesn't match worktree SYMLINKS (one got committed, broke CI install); Sentry `beforeSend` doesn't cover transactions. Optional follow-up from the RLS gate: add a cross-tenant UPDATE negative case to `tests/rls/comment_reads.test.sql` for symmetry.

## 2026-07-02 — RLS pgTAP coverage for comment_reads + users (12/12 tables)

- **Task:** `tests/rls/` covered 10 of 12 tables; added `comment_reads.test.sql` (11 tests) and `users.test.sql` (11 tests) to close the gap, in worktree branch `chore/rls-tests-comment-reads-users`.
- **Models:** planner=opus, executor=sonnet.
- **Outcome:** done (PR opened) — `supabase test db tests/rls` 105/105 across all 14 files, run against the CI-pinned CLI/service config.
- **Notes:** `comment_reads` (0014) tests `comment_reads_select_own`/`_insert_own`/`_update_own` (all scoped via `EXISTS (... memberships ...)`, not a direct agency_id column) + no-DELETE-policy + anon-deny, including a same-tenant own-row-isolation case (Alice can't see Toby's marker) and a superuser-seeded cross-tenant row to prove the membership EXISTS check — not just ownership — blocks Bob. `users` (0002) tests `users_select_self`, `users_select_agency` (incl. a user with memberships in TWO agencies seeing users from both), `users_update_self`, no-INSERT-policy (throws 42501, since INSERT WITH CHECK failure always errors, unlike UPDATE/DELETE which silently filter to 0 rows), no-DELETE-policy, anon-deny, and an isolation case (a user with zero memberships can still read their own row, proving `users_select_self` doesn't depend on `users_select_agency`).
- **Gotcha (if any):** **`npx supabase` (latest, currently v2.109.0) fails ALL RLS test files** — including every pre-existing one — with `permission denied for table memberships`, even after a full `supabase stop --no-backup && supabase start`. The repo's CI pins `supabase/setup-cli@v1` at `version: 2.75.0` and starts with `-x realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor` (`.github/workflows/ci.yml`). Reproducing that exact CLI version + flag set (`npx -y supabase@2.75.0 start -x ...`) fixed it and gave a clean 105/105 pass — something changed between 2.75.0 and 2.109.0 in how default grants/roles get bootstrapped for `supabase test db`. Rule: don't validate `tests/rls/` with a bare `npx supabase` — pin the CLI to match `.github/workflows/ci.yml` exactly, or a false "docker/CLI is broken" conclusion follows. Also: `supabase stop --no-backup` wipes the local `hudo-dev` Docker volume — avoid it if there's local dev data worth keeping.

## 2026-06-21 — Fixed 2 stale source-pattern unit tests (PR #115)

- **Task:** Fix the two known-stale source-scanning unit tests that blocked wiring `pnpm test` into CI. Tester run for GLM-5.2 driving a self-terminating agent loop (Reason→Act→Observe→Check, solo loop, 6-pass hard cap).
- **Models:** planner=opus, executor=glm-5.2 (solo loop, no second-brain/docs layer).
- **Outcome:** done (pending merge) — `pnpm test` 824/824 (0 failing); full gate green; PR #115 open, not merged.
- **Notes:** Test-file-only edits, source untouched (verified via `git diff main --stat` = 2 `.test.*` files only). Test 1 (`GuestComments.test.tsx:42`): strip `/* */` + `//` comments before `doesNotMatch(/resolve|reply|delete/i)` — the regex was matching the component's own doc comment. Test 2 (`route.test.ts:25`): `.*` → `[\s\S]*` so `/authorization…Bearer…cronSecret/` crosses the newline between route.ts:17 and :18; added `assert.match(source, /timingSafeEqual/)` hardening. Loop used **2 passes** (one per file), well under the 6 cap; no tripwires hit. The GLM loop behaved exactly as hoped: short plan first, minimal edits, read real test output, stopped at open PR.
- **Gotcha (if any):** Two cosmetic shell artifacts from `git commit -m "…"` and `gh pr create --body '…'` — backtick-quoted `Bearer ${cronSecret}` in the commit body got stripped by shell command substitution, and the PR body's `$(git diff --stat main)` left a stray leading `'` from quote-escaping. Neither affects the diff/tests; use a HEREDOC or `git commit -F` for messages containing backticks/`$`. Also: CLAUDE.md's stale-tests note (line 33) and the "42 unit tests" count (line 121) were updated in the same commit — the on-disk file had drifted from the system-prompt snapshot.

## 2026-06-21 — PR #114 CodeRabbit Major findings addressed

- **Task:** Triage + fix CodeRabbit's review on PR #114 (pricing rebuild / single source of truth).
- **Models:** planner=opus, executor=opus (small lib edits).
- **Outcome:** done (pushed `a6567a9`) — full local gate green (format/type-check/build); billing suite 125/125. CI + CodeRabbit re-running.
- **Notes:** 10 inline comments triaged. 1 stale (drift test already wired to `PLAN_IDS` in `1361a9f`). Fixed 4: (1) `lib/plan-gates.ts` `checkPlanLimit` now throws `PlanLimitUnavailableError` (→503) when the `agencies` plan query errors, instead of silently defaulting to freemium and denying a paying customer's seats — same fail-closed contract as the existing `countSeats` path, +2 regression tests; (2) `lib/plans.ts` `LOOKUP_KEY_TO_PLAN` throws on a duplicate lookup_key at module load; (3) `lib/stripe.ts` `resolvePriceId` now lists `limit:2` and throws if >1 active price shares a lookup_key (was silently picking the first); (4) `scripts/setup-stripe.ts` no longer logs `key.slice(0,12)` of the secret. Skipped as non-issues: `scripts/tsconfig.json` `strict:true` (already inherited via `extends ../tsconfig.json`) + the 4 Minor style/doc nits.
- **Gotcha (if any):** CodeRabbit's `CHANGES_REQUESTED` on #114 was bot-only — all human-relevant CI was already green; the block was these review threads, not a failing gate. When triaging, verify each finding against current source first: 1 of 10 here was already fixed by an earlier commit and CodeRabbit hadn't re-resolved it.

## 2026-06-18 — S3 Billing Journey: merged + live-verified

- **Task:** Merge BILLING-004/006 (#108), 005 (#111, superseded #109), 003 (#110); apply migration 0019; live-verify.
- **Models:** planner=opus, executors=sonnet, reviewers=hudo-security-reviewer + CodeRabbit.
- **Outcome:** done — all merged to main; migration 0019 applied to dev+staging; Sprint 3 → 8/13. CodeRabbit findings on #108/#109 all fixed (membership-error→500 vs 403, rate-limit-after-authz, billing_address schema validation, multi-agency portal scoping, getSiteOrigin return_url, env guards).
- **Notes:** Live walk via local `pnpm dev` (Stripe TEST mode): billing page (owner-only, usage bars Agents 1/5, Storage 0/5GB) → Upgrade Starter → legal form → DPA modal → real `cs_test_…` Stripe Checkout ("Starter £49/mo"). DB confirmed `legal_name`/`billing_address`/`dpa_accepted_at` (01:42:49) / `dpa_accepted_ip` (`::1`) all persisted. Stopped before completing payment (Stripe's checkout now has an "I am an AI agent" disclosure; and the webhook plan-flip can't fire locally anyway).
- **Gotcha (if any):** (1) **`.env.local` `\n` bad-paste artifacts** broke local checkout — `NEXT_PUBLIC_APP_URL` with a trailing `\n` → `StripeInvalidRequestError: Not a valid URL` (success_url = `localhost:3000\n/...`). NOT a code bug. Override at launch: `NEXT_PUBLIC_APP_URL=http://localhost:3000 NEXT_PUBLIC_BILLING_ENABLED=true pnpm dev`. Same `\n` class as the `.env.staging` Failure-Log entry. (2) **`owner@hudo.test` is a soft-deleted auth user** in hudo-dev — raw `auth.users` SQL/MCP see it but `admin.listUsers()`/login don't (→ "user not found" on reset, login fails). Use `upload-test-1781512596638@hudo-dev.local` / `TestPassword123!` instead. (3) **MCP `apply_migration` and auth-password resets are blocked by the auto-mode classifier** without explicit per-action user consent. (4) **Webhook plan-flip remains live-unverified** — Stripe CLI session expired (needs `stripe login` + `stripe listen`); the handler is unit-tested but the Stripe→webhook round-trip wasn't driven. Vercel **preview** env has NO Stripe vars + billing flag unset, so a preview walk needs provisioning first.

## 2026-06-18 — S3 Billing Journey Step 3 (BILLING-003)

- **Task:** S3-BILLING-003 (plan feature gates + grace period) on `feat/s3-billing-003-plan-gates` (off main).
- **Models:** planner=opus, executor=sonnet (build), reviewer=hudo-security-reviewer.
- **Outcome:** done (pending PR + migration apply) — gate green; tests 94/94 (plan-gates 68, billing 26).
- **Notes:** Migration `0019_agencies_grace_period.sql` adds `grace_period_ends_at`. `lib/plan-gates.ts`: added `storage` to PLAN_LIMITS + `getPlanStorageLimitBytes()` + pure `isGracePeriodExpired()`. `lib/billing.ts`: payment_failed sets `grace_period_ends_at = invoice.created + 7d`; checkout/subscription.updated set `storage_limit_bytes` from plan and clear grace on recovery; **subscription.deleted now resets storage_limit_bytes to freemium** (security-review Medium fix). presign + invitations/send routes get a grace-expired 402 block (fail-closed 503 on DB error — Low fix). Pre-existing storage cap kept. **Finding: the presign storage cap already existed (via storage_limit_bytes); the genuinely-missing work was the grace period + making storage_limit_bytes plan-derived (it was a static 5GB default, so paid plans never got more storage).**
- **Gotcha (if any):** **MCP `apply_migration` to hudo-dev/staging is blocked by the auto-mode classifier without explicit per-change user consent** — shared-infra writes need the user to approve (or run `/apply-migration`). Migration 0019 is written + committed but NOT yet applied; the column must exist on both DBs before `NEXT_PUBLIC_BILLING_ENABLED=true` or the gate queries 500.

## 2026-06-18 — Unblock S3: land #102 + #104 + #106, clean main

- **Task:** Plan "Unblock Sprint 3" (PRs #102 foundation, #104 webhook, #106 founding-member)
- **Models:** planner=opus, executor=opus (git orchestration kept in main thread), security=hudo-security-reviewer
- **Outcome:** done — main healthy; S3 now 4/13 (S3-BILLING-002 done, Linear synced)
- **Notes:**
  - **#102 (foundation):** Addressed all 9 CodeRabbit findings (settings.json matcher `Write`→`Edit|Write` + portable `$CLAUDE_PROJECT_DIR` in PostToolUse/Stop hooks; pr-fix-loop.md real-error surfacing + `--json/--jq` status extraction; lib/stripe.ts `STRIPE_SECRET_KEY` guard + `Record<StripePlan,string>` test prices; setup-stripe-test.mjs `resource_missing`-only catch; docs import fix). Ran full local gate (format/type-check/lint/build) green.
  - **#102 conflict (not in plan):** branch was CONFLICTING with main — main had already merged the _same_ automations via **#101**, so .claude/settings.json + pr-fix-loop.md + CLAUDE.md + SESSIONNOTES.md were add/add conflicts. Resolved by `git merge origin/main` into the branch (repo squash-merges, so the merge commit collapses): automation files → "ours" (verified delta vs main = exactly my 3 settings fixes), CLAUDE.md/SESSIONNOTES.md → union of both sides. Re-ran `pnpm build` on the merged tree (first time #103/#105 + stripe foundation combined) — green. Merged → main now has stripe@^22.2.1, tasks/sprint-3.md, lib/stripe.ts, lib/feature-flags.ts.
  - **#106 (founding-member chore):** committed the two untracked files (0020 migration + create-beta-agency.mjs) on a separate branch. Migration 0020 was **already applied + tracked** on dev+staging (`agencies_founding_member`, 20260616114625/…628) — verified, NOT re-applied (would dup the tracking row). Merged.
  - **#104 (webhook):** rebased onto new main; lib/stripe.ts add/add collision resolved as the **union** (main's typed/guarded foundation + the webhook's `getPlanFromPriceId` reverse-lookup) — confirmed single `getStripe`/`getPlanFromPriceId` on main. Redundant stripe-dep commit **auto-dropped** by rebase ("patch contents already upstream"). Migration 0018 (`current_period_end`) already applied+tracked on both DBs. Security gate (hudo-security-reviewer): **SHIP** — raw-body sig validation, event-ID idempotency, key segregation, tenancy all PASS. Build+RLS green. Merged; `orchestrate done S3-BILLING-002`.
  - **Verified main healthy:** stripe dep + sprint-3 + lib/stripe.ts/lib/billing.ts/webhook route all on main; 0017/0018/0020 tracked on both dev+staging; `agencies.is_founding_member` + `current_period_end` present; no open PRs; status 4/13.
- **Gotcha:** A branch can CONFLICT because its work was already merged via a _sibling_ PR (#101) — check `gh pr view --json mergeable` early; resolve with a merge (not rebase) when the repo squash-merges and you've already pushed. Also: migrations applied via MCP `apply_migration` in a prior session are already tracked — probe `information_schema` + `schema_migrations` before re-applying, or you create a duplicate tracking row.
- **Deferred (non-blocking, from security review + CodeRabbit on #104):** add `import 'server-only'` to lib/billing.ts + lib/stripe.ts; UNIQUE constraint on `agencies.stripe_customer_id`; sanitize webhook handler error logging to `err.message`; `type`→`interface` on billing test capture types; the future checkout-session endpoint must set `metadata.agency_id` from the authenticated server session (separate security review when written, covers S3-SEC-003).

---

## 2026-06-17 — S3-BILLING-001: Configure Stripe

- **Task:** S3-BILLING-001
- **Models:** planner=sonnet, executor=sonnet
- **Outcome:** done
- **Notes:** Stripe MCP OAuth connected (live account, restricted permissions: Customers/Coupons/Invoices/Prices/Products/Promotion Codes/Subscriptions — Write only). Created 4 products + prices in both live and test mode. Created `FOUNDING_50` coupon (50% off, 12 months) in both modes. Added `lib/stripe.ts` (lazy singleton, both mode price IDs, `getStripePriceId()` auto-selects by key prefix), `lib/feature-flags.ts` (`isBillingEnabled()` gate), `scripts/setup-stripe-test.mjs` (idempotent test-mode bootstrap), `docs/stripe-setup.md`. Added `stripe` package (v22.2.1). Stripe Tax (UK VAT) and webhook endpoint still require manual Dashboard steps — documented in `docs/stripe-setup.md`. `NEXT_PUBLIC_BILLING_ENABLED=false` in .env.local — billing UI/API gated off until explicitly enabled.
- **Gotcha:** Stripe MCP OAuth session expires quickly — if `complete_authentication` fails with "no OAuth flow in progress", call `authenticate` again and complete immediately. Also: MCP OAuth operates in live mode only; use the `setup-stripe-test.mjs` script with `sk_test_` key to bootstrap test mode resources. Stripe API version for v22.x is `2026-05-27.dahlia` (not the older basil version).

---

## 2026-06-16 — Beta strategy + founding member pricing decided

- **Task:** N/A — product decision
- **Models:** N/A
- **Outcome:** done
- **Notes:** Closed beta via direct invite only (no shared codes). Beta agencies get plan=studio. When billing goes live: 30-day grace period, then drop to freemium unless subscribed. Founding member reward: 50% off for 12 months via Stripe coupon `FOUNDING_50`. Tracked via `agencies.is_founding_member` (migration 0020, applied to dev + staging). Script: `node --env-file=.env.staging scripts/create-beta-agency.mjs "Name" "email" "Full Name"`. Sprint-3 task file seeded.
- **Gotcha (if any):** legal_name, billing_address, vat_number, dpa_accepted_at, dpa_accepted_ip already exist on agencies from 0001 — BILLING-004 needs no new migration for those columns.

---

## 2026-06-16 — Fix the Ralph Loop so it can't run forever

- **Task:** Make the bounded `/pr-fix` path the only path the model can take, and unify the loop's exit promises so every terminal state stops cleanly. (`.claude/` + CLAUDE.md only — plugin cache untouched.)
- **Models:** planner=opus, executor=opus (verbatim-fidelity config/doc edits)
- **Outcome:** done.
  - `.claude/skills/pr-fix/SKILL.md`: `completion-promise: APPROVED` → `RALPH DONE`; `max-iterations: 10` + `disable-model-invocation: true` unchanged.
  - `.claude/pr-fix-loop.md`: all four terminal `<promise>` outputs (no-PR, approved, no-review-yet, 10-commit cap) now emit `RALPH DONE`, each with the distinguishing reason in prose above it; Step 8 still emits no promise (loop continues). Step 2 check name `PR Review` → `AI Code Review` in both the `grep` and the status `awk` line.
  - `CLAUDE.md`: line-63 trigger bullet rewritten to _read & follow_ the bounded SKILL.md and forbid unbounded `ralph-loop:ralph-loop`; added Failure Log entry `[Ralph] Unbounded loop from a model-disabled /pr-fix`.
- **Gotcha:** the ralph-loop stop-hook literal-matches exactly ONE completion-promise string (`[[ "$PROMISE_TEXT" = "$COMPLETION_PROMISE" ]]`) — emitting four distinct promise tokens meant only `APPROVED` ever stopped the loop; the other three terminal states only died via the max-10 backstop. Any multi-exit Ralph prompt must funnel every terminal state through the single configured token.

## 2026-06-16 23:30 — Build all 6 recommended Claude Code automations

- **Task:** Implement the `/claude-automation-recommender` output — turn recurring Failure-Log gotchas into enforced `.claude/` automations. No app code touched.
- **Models:** planner=opus, executor=opus (local-author config artifacts — precise verbatim fidelity to CLAUDE.md rules required)
- **Outcome:** done — added 2 subagents, 2 user-only skills, 1 shared MCP, 2 hooks, docs pass.
  - **Subagents** (`.claude/agents/`): `hudo-security-reviewer` (Critical Architecture Rules + Security surfaces), `rls-tenancy-auditor` (memberships tenancy / 0003 recursion / two-FK embed / soft-delete). Frontmatter: `name`/`description`/`tools: Read, Grep, Glob, Bash`/`model: sonnet`.
  - **Skills** (`.claude/skills/`, `disable-model-invocation: true`): `apply-migration` (MCP `apply_migration` → both dev+staging, never SQL editor; PGRST202 probe), `live-smoke-test` (Playwright on a Preview branch URL — dashboard render, playback `readyState 4`, comment thread, clean `media-src`).
  - **MCP** (`.mcp.json`): added `context7` alongside existing servers (user chose project-scoped/shared over local).
  - **Hooks** (`.claude/settings.json`): (1) PreToolUse `Write` on `supabase/migrations/*.sql` → advisory `systemMessage` (apply via MCP to both DBs); (2) PostToolUse extended — after type-check, runs the colocated `*.test.ts(x)` (edited test directly, else sibling) via `pnpm exec tsx --test`, non-blocking.
  - **Docs:** CLAUDE.md Code Quality section rewritten to describe both new hooks + the agents/skills/MCP; MEMORY.md gained a "Claude Code Automations" note.
- **Notes:** `.mcp.json` already existed (MCP_DOCKER, figma-desktop, figma-remote) — appended context7 rather than overwriting. settings.json built via a Python script (json.dump) to avoid hand-escaping the shell-in-JSON; both JSON files validated with `python3 -m json.tool`. Verified live: migration-warn fires on `.sql` and is silent on `.md`; PostToolUse on `lib/rate-limit.ts` ran type-check then its sibling test (11/11 pass) and is silent on `.md` (no false positive that could block edits).
- **Gotcha (if any):** When generating shell-command strings for settings.json via Python, `\\\"` in a Python double-quoted literal yields a literal `\"` (backslash+quote) — wrong inside a shell single-quoted `echo '{...}'` where the inner double-quotes must be bare. Use a single `\"` (= bare `"`). Always decode-and-eyeball the generated `command` strings, not just `json.tool`-validate.

---

## 2026-06-16 — Wire up `pnpm test` (tsx) + fix MEMORY.md dead pointer

- **Task:** `chore/wire-unit-tests` — two audit follow-ups: (1) fix MEMORY.md's dead `docs/gotchas-and-lessons.md` pointer → point at the 3 real homes (CLAUDE.md Failure Log + SESSIONNOTES.md + `docs/Hudo App 2026/` vault); (2) add a runnable `pnpm test`.
- **Models:** planner=opus, executor=opus (small mechanical change)
- **Outcome:** done — `pnpm test` = `tsx --test '**/*.test.ts' '**/*.test.tsx'`; `tsx@^4.19.2` added as a devDependency (was only a transitive peer). 42 test files / 649 cases, 647 pass.
- **Notes:** User decided (mid-task) **not** to wire a CI step and **not** to fix the 2 failing tests now — so `.github/workflows/ci.yml` is untouched and CLAUDE.md's "Unit tests gap" note was reworded (not deleted) to stay honest: script exists, CI still doesn't run it, 2 known-stale tests fail.
- **Gotcha (if any):** Both failures are **stale source-pattern assertions**, not code bugs — `components/guest/GuestComments.test.tsx:43` (`doesNotMatch(/resolve|reply|delete/i)` matches the file's own doc comment) and `app/api/cron/notifications/route.test.ts:26` (single-line `.` regex can't span the multi-line `timingSafeEqual` auth check). Fix these two before ever adding `pnpm test` to CI. The 3 `.test.tsx` files are source-invariant (no DOM) so they run fine under `tsx --test` — the glob just needs both extensions.

---

## 2026-06-16 — Vercel Deployment Protection intentionally disabled

- **Task:** N/A — deliberate config decision
- **Models:** N/A
- **Outcome:** done
- **Notes:** Deployment Protection on `hudo-2026` was disabled (via Vercel API) during the S2 Playwright walkthrough and is being left off intentionally to keep staging testing frictionless during S3 development. Re-enable before any external-facing exposure or before go-live.
- **Gotcha (if any):** Staging is effectively public while protection is off — do not share the preview URL publicly or commit real credentials to branches.

---

## 2026-06-16 15:40 — Fix seed-staging: backfill R2 bytes so seeded video plays

- **Task:** `chore/seed-staging-r2-upload` — `scripts/seed-staging.mjs` inserted the video/version rows but never uploaded any R2 object, so the seeded "Staging Test Reel" (`7cb31754…`) returned `403 NoSuchKey` → `<video>` format error. Fix the script durably **and** backfill the existing seed.
- **Models:** planner=opus, executor=opus (single `.mjs` + live R2/Playwright verification)
- **Outcome:** done — script fixed, asset bootstrapped, seed backfilled, playback live-verified.
- **Notes:** Added an idempotent R2 backfill **outside** the `if (!video)` guard (so it fixes the already-seeded row): re-reads `active_version_id` → version `r2_key` from the DB (don't trust the in-memory `video` — fresh-create path never refreshes it), `HeadObject`s the key, and on `NotFound` `CopyObject`s from a stable seed-owned asset `seed/staging/_assets/sample-v1.mp4`, then syncs `file_size_bytes`/`duration_seconds`. The asset is bootstrapped once (`--bootstrap` flag) via server-side copy from the crown-jewel upload (`3e44aa4d…/55c07ab0…/d6b735f2….mp4`) — no repo binary, self-contained in the bucket. **Must target bucket `hudo-staging`** (override `R2_BUCKET_NAME=hudo-staging`) — the deployed app signs against `hudo-staging`, but local `.env.staging` carries a stale `R2_BUCKET_NAME="hudo-dev"`. Verified: HeadObject crown-jewel = 200 in `hudo-staging` / 404 in `hudo-dev` (creds are account-wide, confirms object's home bucket). Live Playwright (preview, `owner@hudo.test`): video plays — `readyState 4`, `error: null`, `currentTime` advanced to 3, decoded 320×240, src is the seed key in `hudo-staging`; console clean of `media-src`/format errors. Idempotent re-run logs "object already present".
- **Gotcha:** Local `.env.staging` has `R2_BUCKET_NAME="hudo-dev"` but the deployed staging app reads/writes the **`hudo-staging`** bucket — any seed/backfill MUST override `R2_BUCKET_NAME=hudo-staging` or bytes land in the wrong bucket. Also: the deployed **production**-target domain (`hudo-2026-…vercel.app`) points at a _different_ Supabase than staging (seed users 401 there) — drive the **Preview** branch URL (`…-git-<branch>-…vercel.app`) for staging-data verification.

---

## 2026-06-16 — Fix playback CSP (allowlist R2 in `media-src`)

- **Task:** Last of the three `STAGING_WALKTHROUGH_REPORT.md` P1s — playback dead because `media-src 'self' blob:` blocked the signed R2 URL the `<video>` loads. Branch `fix/playback-media-src-csp`, single PR.
- **Models:** planner=opus, executor=opus (one-line config + small test); gate=devsecops-security-engineer (sonnet).
- **Outcome:** done — added `https://*.r2.cloudflarestorage.com` to `media-src` (mirrors `connect-src`); extracted `CSP_DIRECTIVES` const + added `next.config.test.ts` regression guard (4 tests pass). format/type-check/lint clean. Existing playback suites green (22 tests, 0 fail). Security review PASS/LOW.
- **Notes:** One global CSP (`/(.*)`) covers both authed `/videos/[id]` and guest `/guest/[token]`. Rejected proxy/stream-through-app alternative per user decision (egress + Range cost).
- **Gotcha:** Pre-existing unrelated failure in `app/api/cron/notifications/route.test.ts` — a stale source-invariant regex that no longer matches the `timingSafeEqual`-based CRON_SECRET check; not touched by this PR, flag for a separate fix.
- **Gotcha:** `npx tsx --test` treats `[videoId]`/`[token]` dirs as glob char-classes, so passing those paths directly matches nothing (silent "0 tests"). Run the suite via a recursive glob like `npx tsx --test 'app/api/**/*.test.ts'` instead.

---

## 2026-06-16 — Fix both dashboards (ambiguous embed) + wire comment UI into video page

- **Task:** Two of the three P1s from `STAGING_WALKTHROUGH_REPORT.md` (playback CSP left out of scope). Branch `fix/dashboard-embed-and-comment-wiring`, single PR.
- **Models:** planner=opus, executor=sonnet; reviews=code-reviewer + devsecops-security-engineer + code-simplifier (all sonnet).
- **Outcome:** done — type-check/lint clean, 30/30 unit tests pass, code review found no high-confidence issues, security review LOW/safe, simplifier found nothing to change.
- **Notes:**
  - **Dashboard embed fix:** named the FK on both unhinted `videos→video_versions` embeds (`video_versions!video_versions_video_id_fkey`) at `lib/dashboard.ts:100` and `lib/talent-dashboard.ts:89`. Grep confirmed these were the only two unhinted sites; the comment-count queries select `FROM video_versions` (not ambiguous). Anti-recurrence: `/dashboard` page now captures `getAgencyVideos` `error` and `AgentDashboard` renders an inline "couldn't load" state (it previously dropped the error and rendered silently empty).
  - **Comment UI wiring (provider lift):** new `components/player/VideoPlayerProvider.tsx` owns the player engine (`videoRef`, `useVideoPlayer`, range state, `usePlayerShortcuts`, the `handle` memo) and provides 3 contexts so a sibling `CommentPanel` reaches the _live_ player context. `VideoPlayer.tsx` slimmed to presentational (reads contexts; dropped `forwardRef`). `app/(dashboard)/videos/[id]/page.tsx` wraps `VideoPlayerProvider` and mounts `CommentPanel` in the `MobilePlayerLayout` panel slot. `agencyId` added to `GET /api/videos/[videoId]/versions` (additive, behind existing authz) so the page sources the _video's_ agency (correct for multi-agency users).
  - **Advisor caught a regression trap pre-delegation:** `PlayerControls` needs the full `VideoPlayerState` (volume/mute/fullscreen), which is NOT on `VideoPlayerHandle`. The provider exposes a separate `VideoPlayerStateContext` for it; without that the tempting "fix" is deleting those props — invisible to Playwright since media is CSP-blocked on preview.
- **Gotcha (if any):** Comment components import `useVideoPlayerContext`/`VideoPlayerHandle` from `@/components/player/VideoPlayer`; to keep them unchanged after moving the context into the provider, `VideoPlayer.tsx` _re-exports_ both from `./VideoPlayerProvider`. Also: no `test` script in package.json — `node:test` unit suites run via `npx tsx --test <files>` (path-alias `@/` imports fail under bare `node --test`).

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

## 2026-06-16 14:50 — First live Playwright walkthrough of deployed staging

- **Task:** Autonomous end-to-end drive of deployed staging (Playwright MCP) — screenshot-backed pass/fail per feature. Report: `STAGING_WALKTHROUGH_REPORT.md`.
- **Models:** planner=opus, executor=opus (interactive browser drive)
- **Outcome:** done — 11 features exercised against the live stack (not mocks)
- **Notes:** Disabled Vercel Deployment Protection via API (`PATCH /v9/projects/{id}` `{ssoProtection:null}`) — staging now PUBLIC, re-enable before exposure. Seeded via `scripts/seed-staging.mjs` + 3 filler agents (agency at 5/5 agent cap) + 2 spare gate-test users. **Crown jewel PASS: R2 key reaches `hudo-staging`** — upload PUT `200 OK` to `hudo-staging.…r2.cloudflarestorage.com`. PASS: notifications (incl. true realtime postgres_changes push), preferences persist, seat gate `402`/`201`, PDF export (`%PDF`), guest link read-only with zero auth. **3 P1 FAILs found** (all invisible to the mocked suite) — see Failure Log.
- **Gotcha:** Every prior "pass" was a mocked unit test; the live drive immediately exposed 3 broken core flows. A thin live smoke test (dashboard query, playback-url, comment render) against a preview would have caught all three.

## 2026-06-16 06:00 — PR #95 live verification complete (talent side)

- **Task:** Finish live talent-side verification of PR #95 (`fix/dashboard-embed-and-comment-wiring`) on the Vercel preview; close out.
- **Models:** planner=opus, executor=opus (interactive browser drive)
- **Outcome:** done — all live checks pass; PR is green and merge-ready (hand back to user to merge).
- **Notes:** Signed in as `talent@hudo.test` on the preview. `/talent` now lists "Staging Test Reel" (in review, v1) — no longer "Unable to load" (embed FK-hint fix confirmed live for the talent dashboard too). Notifications bell shows **1 unread**; panel renders the unread `new_comment` (51m ago = the owner comment posted earlier this session) above the two seeded ones — comment→notification path fires end-to-end through the mounted UI. Only console error is the benign `vercel.live/feedback.js` CSP block (no video on this page, so no `media-src` errors). Owner-side checks (dashboard list, CommentPanel mount + 3 seeded comments, post persists camelCase, notifications created in DB) were confirmed earlier in the session.
- **Gotcha (if any):** Vercel Deployment Protection is still DISABLED on `hudo-2026` (turned off via API for the drive) — must be re-enabled in Vercel → hudo-2026 → Settings → Deployment Protection. Out-of-scope items deferred to separate PRs: playback `media-src` CSP, PostHog CSP, sign-out 405, `/dashboard` Talent "Unknown" (null seed `full_name`).

## 2026-06-16 07:15 — PR #95 merged + Linear sync reconciled (S2 closeout)

- **Task:** Merge PR #95; then "update all docs and Linear, make sure fully synced."
- **Models:** planner=opus, executor=opus
- **Outcome:** done — PR #95 squash-merged to `main` (`82a9598`, 15 files, +558/-165); Linear now 15/15 (pending search-index propagation, see gotcha).
- **Notes:** PR #95 (`fix/dashboard-embed-and-comment-wiring`) merged squash + branch deleted, after full live verification (owner + talent) on the preview. Doc/Linear closeout done on `chore/pr95-closeout-docs-linear-sync` (NOT main). `orchestrate.js sync-check` showed 14/15 in sync; the 15th, `S2-WIRE-001`, returned `? (error)` because **no Linear issue existed for it** — it was added to `tasks/sprint-2.md` during S2 closeout but never created in Linear (delivered via PR #90). Created it as `RES-196` (status Done, Sprint 2 project, `size:S`), mirroring `RES-195`/S2-SHELL-001 (the other retroactively-added S2 issue). `sync-fix` could NOT have fixed this — it only pushes status to _existing_ issues.
- **Gotcha (if any):** `sync-check` "error" ≠ "drift": a missing Linear issue is a permanent error `sync-fix` won't touch — you must create the issue. And Linear's `searchIssues` index lags new issues by minutes, so `sync-check` keeps showing the error briefly after creation even though the issue exists. Logged to CLAUDE.md Failure Log. **Open decision (surfaced to user, not actioned):** `sprint-2.md` header still says "Status: In Progress" with 15/15 done — closing S2 is a gate call while the playback `media-src` CSP P1 is unresolved.

## 2026-06-17 14:30 — S3 Batch 1 dispatched, reviewed, fixed, CI-green (BILLING-002 / COMPLY-001 / SEC-004)

- **Task:** S3 Batch 1 — parallel Sonnet agents for S3-BILLING-002 (Stripe webhook, PR #104), S3-COMPLY-001 (audit log, PR #103), S3-SEC-004 (storage reconcile cron, PR #105).
- **Models:** planner=opus, executors=sonnet (build) + sonnet/haiku (review-fixes)
- **Outcome:** done (pending merge) — all 3 PRs CLEAN/green; migrations 0017 (audit indexes) + 0018 (agencies.current_period_end) applied to hudo-dev + hudo-staging and schema-verified.
- **Notes:** Three agents ran in isolated worktrees. Corrected `tasks/sprint-3.md` first (audit_log table+RLS already exist from 0001/0002 → COMPLY-001 migration is indexes-only; real route paths differ from spec; COMPLY-003 cookie-consent already built = verify-only; 0020 already taken → free slots 0017/0018/0019). Review gates: hudo-security-reviewer ×3, devsecops ×1 (#104), rls-tenancy-auditor ×1 (#103), code-simplifier ×1 (#104). #104 had 2 BLOCKERS fixed: (1) `customer.subscription.created` was unhandled → new paid subscribers stuck on `freemium`; (2) idempotency key was claimed BEFORE processing → a crash/timeout permanently silenced the event (moved SET-NX to after success). Plus zero-row-match and missing-agency_id now throw instead of silent-200. #105: bounded concurrency + `maxDuration=60`.
- **Gotcha (if any):** **Worktree agents ran `type-check && lint` but NOT `pnpm build`, so two build-only failures passed local checks and only failed in CI** — see Failure Log. Also: **S3-BILLING-001 is "done" on `chore/claude-config-automations` but never merged to main, so main has NO `stripe` dep** — #104 now self-carries it (ported the exact `stripe@^22.2.1` manifest+lock from commit 9312933). Stripe SDK v22 moved `current_period_end` to item-level (`subscription.items.data[0]`).

## 2026-06-18 — S3 Billing Journey Step 2 (BILLING-005)

- **Task:** S3-BILLING-005 (billing UI + Stripe Customer Portal) on `feat/s3-billing-005-billing-ui` (branched off Step 1).
- **Models:** planner=opus, executor=sonnet (build), reviewer=hudo-security-reviewer.
- **Outcome:** done (pending PR) — full gate green; portal route tests 12/12.
- **Notes:** Owner-only Settings→Billing page (service-role two-query owner gate, mirrors notifications page), `BillingOverview` (plan/status/renewal + usage bars + upgrade→legal→DPA→checkout state machine), `UsageBars` (agents/talent from PLAN_LIMITS, storage from `agencies.storage_limit_bytes` DB column — NOT PLAN_LIMITS), portal route, AppHeader "Billing" link (flag-gated). No Shadcn `Progress` in components/ui → Tailwind bar w/ role=progressbar.
- **Gotcha (if any):** Security gate Medium — a **multi-agency owner** could open the portal for a _different_ agency than the page showed: both the page and the portal route resolved the agency via `.eq('role','owner').limit(1)` with **no ORDER BY** (non-deterministic). Fixed: portal route now takes `agencyId` in the POST body and authorizes owner-in-THAT-agency; the page passes its resolved agencyId through. Rule: any "resolve the user's agency" lookup for a user who can belong to many agencies must be explicitly scoped, never `.limit(1)` un-ordered. Low: stopped serializing `stripe_customer_id` to the client (now a `hasStripeCustomer` boolean).

## 2026-06-18 — S3 Billing Journey Step 1 (BILLING-004 + 006)

- **Task:** S3-BILLING-004 (legal entity data) + S3-BILLING-006 (DPA acceptance gate), built together on `feat/s3-billing-004-legal-entity` — they converge through one checkout route.
- **Models:** planner=opus, executor=sonnet (build), reviewer=hudo-security-reviewer.
- **Outcome:** done (pending PR) — `pnpm format:check && type-check && lint && build` all green; billing unit tests 43/43 pass.
- **Notes:** Folded the missing **Stripe Checkout Session creation** into BILLING-004's `app/api/agencies/[id]/billing/route.ts` POST (no task owned it, but the done webhook expects a `checkout.session.completed` keyed on `metadata.agency_id`). Route validates legal_name + billing_address + `dpa_accepted_at` **against the DB row** (not request body → no client bypass), owner-only, rate-limited, behind `isBillingEnabled()`. Pure logic extracted to `lib/billing-checkout.ts` (route-export rule + testability). Security gate: 1 Medium + 1 Low, both addressed.
- **Gotcha (if any):** **`import 'server-only'` THROWS under tsx/node:test** — adding it to `lib/stripe.ts` broke 23 `lib/billing.test.ts` cases (billing.ts → stripe.ts value import). Reverted; instead decoupled `lib/billing-checkout.ts` from `lib/stripe.ts` (caller now passes `priceId`+`coupon`; only a type import remains). To actually give `lib/stripe.ts` server-only you must first split secret-touching `getStripe()` into its own module away from the test-imported helpers — deferred. Also: dpa-accept IP capture must use `x-real-ip` / leftmost `x-forwarded-for` (Vercel puts the client IP FIRST; `.at(-1)` was recording Vercel's proxy).

## 2026-06-18 — Pricing rebuild: single source of truth for plan tiers

- **Task:** Rebuild plan/pricing tiers as one canonical `lib/plans.ts`; everything derives from it. New lower prices (£15/£39/£89 monthly + annual), talent metering removed (unlimited), agent seats = primary lever, storage soft cap, grandfather existing subscribers. Branch `feat/pricing-rebuild-single-source`.
- **Models:** planner=opus, executors=sonnet (libs/routes/UI/scripts/tests, ~8 agents on disjoint files), reviewers=devsecops-security-engineer + pr-review-toolkit:code-reviewer.
- **Outcome:** done (pending PR) — full local gate green (format/type-check/lint/build); unit suite 820/822 (only the 2 documented stale source-pattern failures). Migration 0021 applied to hudo-dev + hudo-staging (verified: default now 10 GiB, all orgs backfilled). Stripe TEST setup created 6 new lookup_key'd prices + archived 3 old; `verify-plan-consistency.ts` PASS.
- **Notes:** `lib/plans.ts` = the only place tier numbers live (`as const satisfies Record<PlanId,Plan>`; storage = `N*GiB`). `lib/stripe.ts` resolves prices by **lookup_key** now (`resolvePriceId`), webhook maps price→plan via `getPlanFromPrice(price)`: lookup_key → `LEGACY_PRICE_ID_TO_PLAN` (8 old IDs) → freemium. `lib/plan-gates.ts` is agents-only (talent gate deleted from `talent/route.ts`; `members/route.ts` caller drops the `'agents'` arg). Checkout route gained `interval: month|year`. UI: per-tier cards + monthly/annual toggle; UsageBars shows talent as count-only + `formatBytes` extended to TB. New `scripts/setup-stripe.ts` (mode by key prefix, idempotent, +live `--yes`/readline confirm gate) replaces `setup-stripe-test.mjs`; new `scripts/verify-plan-consistency.ts` drift guard (local-only — needs Stripe secret, can't run in CI). Security review LOW (no Crit/High/Med); code review verified the two highest-risk invariants.
- **Gotcha (if any):** **The price→plan reverse map MUST include BOTH monthly AND annual lookup_keys** (6 entries) — building it from monthly only would silently downgrade every ANNUAL subscriber to freemium on their next `subscription.updated` (same bug class as the legacy-ID grandfathering trap). And the migration CASE bytes can't import plans.ts (SQL) → they're the one hand-authored copy and must equal `N*GiB` exactly (agency_pro = 1 TiB = 1099511627776, the deliberate 2 TB→1 TB cut; freemium default 5→10 GiB).
