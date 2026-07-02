# Hudo — CLAUDE.md

Video review platform for talent agencies. Frame.io-style: upload → timestamped comments → resolve → approve. SaaS, multi-tenant, UK market.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 App Router, TypeScript strict, Tailwind, Shadcn UI |
| Auth | Supabase Auth (email/password only; social = post-MVP) |
| Database | Supabase PostgreSQL + RLS on every table |
| Realtime | Supabase Realtime (scoped to `video_version_id` only) |
| Storage | Cloudflare R2 (private bucket, signed URLs) |
| Rate limiting | Upstash Redis |
| Email | Resend |
| Payments | Stripe + Stripe Tax (UK VAT) |
| Monitoring | Sentry + PostHog (consent-gated) |
| Hosting | Vercel |
| Package manager | pnpm, Node 22 LTS (CI; `engines` allows >=20, but `pnpm test` needs 21+ for `node:test` globs) |

## Commands

```bash
pnpm dev                      # Next.js dev server
pnpm build                    # production build (CI gate)
pnpm format:check && pnpm type-check && pnpm lint   # run before every commit
pnpm test                     # node:test unit suite via tsx (app/, lib/, components/, root)
pnpm test:e2e                 # Playwright e2e (tests/e2e)
supabase test db tests/rls    # RLS pgTAP suite (CI: "RLS Policy Tests")
node orchestrate.js status    # live sprint/task state
```

> **Unit tests now in CI:** `pnpm test` (`tsx --test`, 63 files / 943 cases across `app/`, `lib/`, `components/`, `hooks/`, root) is **fully green** and wired into CI as a step in the main job — runs after build (needs Node 21+ for the test-script globs; CI runs Node 22). CI covers Lint/Type-check/Build/Unit-tests + RLS pgTAP (12/12 tables).

## Critical Architecture Rules

- **Video never touches Vercel.** Browser → R2 via presigned URL. Playback via signing proxy only (`/api/videos/:id/playback-url`). Direct R2 URL never returned to any client.
- **Multi-tenancy via `memberships` table**, not `agency_id` on `users`. A user can belong to multiple agencies. All RLS must derive agency context from `memberships`.
- **Guests have zero Supabase access.** All guest data served through API routes. Guest tokens: 32-byte random, SHA-256 hashed in DB, plaintext never stored.
- **`audit_log` is insert-only.** No update/delete policy. Period.
- **Stripe keys never reach client bundle.** Only publishable key on client.
- **PostHog script must not load** (not just be blocked) before cookie consent.
- **Rate limiting via Upstash Redis** on all auth, upload, comment, and guest endpoints. Always return 429 + `Retry-After`.
- **Version numbers via Postgres RPC** (`create_video_version`) — not app logic — to prevent race conditions.
- **Comments soft-delete only** (`deleted_at`). No hard delete via any API endpoint.

## Project Structure

`orchestrate.js`, `orchestrate.md`, `tasks/`, `scripts/`, `docs/`, `lib/`, `supabase/migrations/`, `tests/rls/`. Full tree in [orchestrate.md](orchestrate.md) and docs.

## Orchestrator Workflow

`node orchestrate.js status|next|start|done|review` (+ `prompt`, `gate`, `blocked`, `sync-check`, `sync-fix`). Full commands and task format in [orchestrate.md](orchestrate.md).

## Agent Rules

- Only create/modify files listed in task `FILES`
- Write minimum code to satisfy acceptance criteria — nothing more
- Write tests for every acceptance criterion
- Do not add dependencies without flagging first
- **Branch naming:** sprint tasks use `feat/s<N>-<TASK_ID>-<slug>`; chores/cleanup use `chore/<slug>`. Never commit directly to `main`.
- Commit → push branch → open PR → run `orchestrate.js review`
- After opening a PR, start the bounded review-fix loop by reading **`.claude/skills/pr-fix/SKILL.md`** and following it (it invokes `ralph-loop:ralph-loop` with the prompt from `.claude/pr-fix-loop.md`, a completion-promise, and `max-iterations`). **Never invoke `ralph-loop:ralph-loop` with unbounded defaults** — any Ralph loop you start MUST pass both a finite `--max-iterations` **and** a `--completion-promise`, or it runs forever and can't be stopped manually.
- Before committing, run `pnpm format:check && pnpm type-check && pnpm lint` to catch CI issues locally
- Do not start a task while any `BLOCKED_BY` task is not `done`
- After completing work, update CLAUDE.md with any learnings. If anything broke or surprised you, add an entry to the **Failure Log** section before closing the session — never defer it.

## Model & Workflow Rule

**Planning is Opus. Execution is Sonnet or Haiku. Review is mandatory for important code.**

For any non-trivial task (more than a one-line tweak), the main session (Opus) MUST:

1. **Plan first.** Use `superpowers:writing-plans` for spec'd work or `feature-dev:code-architect` for architecture-heavy changes. Decompose into subtasks; tag each with a complexity (low/medium/high).
2. **Delegate execution** via the `Agent` tool with an explicit `model` override:
   - **Haiku** (`model: "haiku"`) — single-file edits, mechanical refactors, doc updates, test scaffolding, dependency bumps, anything where the answer is obvious from the plan.
   - **Sonnet** (`model: "sonnet"`) — multi-file features, new components, API routes, RLS policies, anything requiring judgement during execution.
   - **Opus** stays in the main thread for planning, review synthesis, and decisions; do not delegate execution back to Opus.
3. **Code-review** every "important" change before commit. Important = touches business logic, auth, RLS, API routes, payment flows, RPCs, or anything in `lib/`, `app/api/`, or `supabase/migrations/`. Use `pr-review-toolkit:code-reviewer` (Sonnet).
4. **Simplify** after review. Run `pr-review-toolkit:code-simplifier` or the `code-simplifier` plugin agent against the same diff. Apply suggestions that don't fight the plan.
5. **Security review** when the change touches a security surface — listed in "Security surfaces" below. Use the `devsecops-security-engineer` agent or `/security-review`. This is a gate, not a suggestion.
6. **Log the run** in `SESSIONNOTES.md` (see below).

### Security surfaces (mandatory security review)

- Anything under `app/api/`
- Any `supabase/migrations/` change touching RLS or new tables
- Auth flows (`lib/auth/`, Supabase Auth wiring, guest-token handling)
- Stripe / billing code
- File-upload / R2-presigning code
- Cookie / session / consent code (PostHog gate)
- Any change to `.claude/settings.json` hooks or new env-var reads

### SESSIONNOTES.md log

Maintain `SESSIONNOTES.md` at the repo root. Append a dated entry whenever:

- A task starts and finishes (one combined entry is fine)
- An error or unexpected behaviour occurs
- A gotcha is discovered (something a future session would also trip on)
- A workaround or fix is applied

Entry format:

```markdown
## YYYY-MM-DD HH:MM — <short title>
- **Task:** <task id or description>
- **Models:** planner=opus, executor=sonnet|haiku
- **Outcome:** done | partial | blocked
- **Notes:** <what happened; what broke; what fixed it>
- **Gotcha (if any):** <one line — surface this so future sessions search and find it>
```

`SESSIONNOTES.md` is the *running build log*; `CLAUDE.md → Failure Log` stays for the most durable rules-of-thumb that get distilled out of recurring SESSIONNOTES gotchas.

## Code Quality

- **Pre-commit hooks** via Husky + lint-staged. Staged files are auto-formatted (Prettier) and linted (ESLint) on every commit. Config in `package.json` under `lint-staged`. **Pre-push** runs `pnpm build` (the real CI gate); skip with `git push --no-verify` when iterating.
- **Claude hooks** in `.claude/settings.json`:
  - **PreToolUse** — blocks any Edit/Write to `.env*` files (exit 2); **and** on a `Write` to `supabase/migrations/*.sql` emits an advisory `systemMessage` (non-blocking) reminding you to apply via Supabase MCP `apply_migration` to **both** hudo-dev and hudo-staging, not the SQL editor.
  - **PostToolUse** — after any `.ts`/`.tsx` edit runs `pnpm type-check` (last 20 lines); **then** runs the colocated unit test: if the edited file is `*.test.ts(x)` it runs that file, else if a sibling `<base>.test.ts(x)` exists it runs `pnpm exec tsx --test <sibling>` and surfaces `tail -20`. Non-blocking/informational — closes the "unit tests, no CI step" gap at edit time (a failing/stale test only prints, never blocks the edit).
  - **Stop** — reminds you to update `SESSIONNOTES.md` when code changed but the file wasn't touched.
- **Project subagents** in `.claude/agents/` — name these in the mandatory review/security steps above:
  - `hudo-security-reviewer` — audits a diff against the Critical Architecture Rules + Security surfaces (R2 signed-URL playback, guest isolation, audit-log immutability, soft-delete, Stripe key segregation, consent-gated PostHog, rate limiting, version RPC).
  - `rls-tenancy-auditor` — audits RLS policies / migrations / PostgREST embeds against the `memberships` tenancy model, the 0003 recursion trap, the `videos`↔`video_versions` two-FK ambiguity, and soft-delete filters.
- **User-only skills** in `.claude/skills/` (run with `/<name>`): `apply-migration` (the safe MCP-`apply_migration`-to-both-DBs migration flow) and `live-smoke-test` (thin Playwright walkthrough of a Preview branch URL — the check that would have caught the 3 P1s the mocked suite missed).
- **Local MCP** in `.mcp.json` (gitignored — **not** team-shared): `context7` for live Next.js 14 App Router / AWS SDK presigner docs. Teammates who want it add it themselves: `claude mcp add context7 -- npx -y @upstash/context7-mcp`.

## Failure Log

When something breaks or surprises you mid-task, add an entry here before closing the session. Write only what's needed to understand the problem and fix — no more. One line if that's enough; a few lines if it isn't.

Format: `- **[Area] Title (YYYY-MM-DD):** what broke + fix/workaround.`

- **[UX] Ship walkable flows, not component piles (2026-05-11):** S1 shipped upload, player, comments, versions — but no app shell, no video list, no root redirect, no shared nav. The app couldn't be walked end-to-end at sprint close. Rule: every sprint must land at least one complete user journey before the gate. New sprint tasks go in tasks/ *only after* confirming the previous sprint leaves a walkable state. For S2: SHELL-001 goes first, dashboards second, feature tracks third.
- **[Orchestrate] `review` blocks `gh pr merge` (2026-05-11):** `orchestrate.js review <ID>` rewrites `tasks/sprint-N.md` locally (in_progress → in_review) and leaves it uncommitted. `gh pr merge` then refuses to checkout main. Fix: commit the status bump before `review`, or `git stash` before merging — `orchestrate.js done` will overwrite the status on main anyway.
- **[Migrations] Schema-cache miss = un-applied migration (2026-05-13):** Two consecutive 500s — `/api/videos/upload/complete` ("Could not find function increment_storage_usage…") then PATCH `/api/videos/[id]` ("Could not find the 'description' column…") — both root-caused to migrations never applied to hudo-dev/staging despite SESSIONNOTES claims. Rule: when an API route 500s with PGRST202 or "column not found in schema cache", probe `information_schema` / `pg_proc` via Supabase MCP `execute_sql` before assuming a code bug, and prefer `apply_migration` over SQL-editor pastes — only the former updates `supabase_migrations.schema_migrations`, so audits and `list_migrations` stay trustworthy. Sub-trap: `components/upload/UploadProgress.tsx` matches any error string containing `"quota"` and renders the friendly over-quota panel, masking the real error class.
- **[Email] `new Resend('')` crashes Next.js build (2026-06-15):** Module-level `const resend = new Resend(process.env.RESEND_API_KEY || '')` throws when the key is absent — Next.js imports route modules during "Collecting page data" and triggers the constructor. Fix: instantiate `new Resend(apiKey)` inside the send function, not at module scope.
- **[Vercel/Cron] Hobby plan = max once per day (2026-06-15):** Both `*/5 * * * *` and `0 * * * *` fail Vercel deployment on the Hobby plan. Only `0 0 * * *` (or less frequent) is valid. See `docs/ops/cron-schedule.md` for upgrade path.
- **[Parallel agents] Disjoint FILES ≠ safe parallelism; use worktrees + node_modules symlink (2026-06-16):** Git's current-branch and working tree are global state — two agents editing different files on different branches in the *same* checkout still collide. Run each parallel build agent in its own git worktree (`isolation: worktree`). A fresh worktree has NO `node_modules` (gitignored, ~631M) so pnpm/type-check/the PostToolUse hook all fail; have the agent symlink it as step 0: `ln -s <main-repo>/node_modules ./node_modules`. Also skip `orchestrate.js start` for worktree agents (it pre-branches in the main dir and collides) — let the orchestrator own all status transitions and run `done` after merge. Caveat: `pnpm add` in such a worktree also dirties the MAIN repo's package.json/pnpm-lock — `git checkout --` them on main; they land via the PR.
- **[Schema] Verify task-NOTES schema claims against migrations before coding (2026-06-16):** Stale `NOTES:` in `tasks/sprint-2.md` caused two near-miss runtime 500s: `notifications` keys on `recipient_id` but `notification_preferences` keys on `user_id` (PK) — they are different tables; and GATE-001's "Plan limits live in `plans` table" is false — no `plans` table exists, limits are a static config keyed off `agencies.plan`. Always grep `supabase/migrations/0001_initial_schema.sql` for the real column/table before trusting a NOTE.
- **[PostGREST] Ambiguous `video_versions` embed breaks both dashboards (2026-06-16):** Since `videos.active_version_id → video_versions.id` was added there are TWO FKs between `videos` and `video_versions`, so any unhinted `video_versions ( … )` embed errors `Could not embed because more than one relationship was found`. Broke `/dashboard` (`lib/dashboard.ts:100` — silent: page ignored the error and rendered empty) and `/talent` (`lib/talent-dashboard.ts:89` — "Unable to load"); only `/videos` (no such embed) worked. Fix: hint the FK — `video_versions!video_versions_video_id_fkey ( … )`. Invisible to the mocked suite (never hits real PostgREST). Rule: any `videos`↔`video_versions` embed MUST name the FK, and don't swallow the PostgREST `error` into an empty render.
- **[CSP] Playback blocked because `media-src` omits R2 (2026-06-16, RESOLVED + live-verified):** `next.config.js` allowed R2 in `connect-src` (upload PUT works) but `media-src 'self' blob:` blocked the `<video>` loading the signed R2 URL → playback dead on staging. **Fix (PR #97):** allowlisted `https://*.r2.cloudflarestorage.com` in `media-src` (one global CSP at `/(.*)` → covers both authed `/videos/[id]` and guest `/guest/[token]` at once). Rejected the proxy/stream-through-app alternative (egress + HTTP-Range cost; signed-URL is the de-facto architecture in code+tests). Rule: any browser-facing R2 resource needs its host in **both** `connect-src` (fetch/XHR) **and** `media-src` (`<video>`/`<audio>`) — independent directives. **Live-verified** on the branch preview (Playwright): authed + guest video both play (`readyState 4`, `currentTime` advances, no error), console clean of `media-src` violations. Guard: `next.config.test.ts` asserts the R2 host stays in both — this is now CI-enforced (unit tests wired into CI as of the chore/wire-unit-tests-into-ci PR).
- **[Seed] Staging "Staging Test Reel" video has no R2 object (2026-06-16, RESOLVED):** seed video `7cb31754-187e-4f68-9a76-6a3a1973e080` (`r2_key seed/staging/7cb31754…/v1.mp4`) had a DB row but the file was never uploaded → GET `403 NoSuchKey` → `<video>` format error. Seed-data gap, not a playback bug — `scripts/seed-staging.mjs` created the row inside the `if (!video)` guard without ever writing bytes. **Fix (`chore/seed-staging-r2-upload`):** the seed now bootstraps a stable seed-owned asset `seed/staging/_assets/sample-v1.mp4` once (`--bootstrap`, server-side copy from the crown-jewel `55c07ab0…` upload — no repo binary) and, **outside** the idempotency guard, `HeadObject`/`CopyObject`s it onto the video's `r2_key` + syncs `file_size_bytes`/`duration_seconds`. Backfill re-reads `active_version_id` from the DB (the fresh-create path never refreshes the in-memory `video`, so verification was blind to creation). **Live-verified** (Playwright, preview): the seed video now plays (`readyState 4`, `error null`, `currentTime` advances, decoded 320×240). Run: `node --env-file=.env.staging scripts/seed-staging.mjs` (no bucket override needed since the `.env.staging` reconcile below).
- **[R2/Env] `.env.staging` drifted from the Vercel preview env (2026-06-16, RECONCILED):** the deployed staging app signs upload/playback against bucket **`hudo-staging`** (crown-jewel + seed signed URLs both hit `hudo-staging.…r2.cloudflarestorage.com`); the Vercel **preview** env's canonical `R2_BUCKET_NAME` is already `hudo-staging`. But the local `.env.staging` had drifted to a stale `R2_BUCKET_NAME="hudo-dev"` **and** carried a literal `\n` on most values (a bad-paste artifact; `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, etc.). **Fix:** `vercel env pull .env.staging --environment=preview --yes` restored clean, artifact-free canonical values for the whole file — so **no `R2_BUCKET_NAME` override is needed locally anymore** (seed runs plain). Verified HeadObject crown-jewel = 200 in `hudo-staging` / 404 in `hudo-dev`. **Two traps:** (1) never strip a trailing literal `\n` from a dotenv file with a regex whose trailing class includes `\s*$` — `\s` matches the line-terminator newline and merges lines, corrupting the file (it ate 16 lines here); `vercel env pull` is the canonical recovery since the file is "Created by Vercel CLI". (2) the **production**-target Vercel domain points at a *different* Supabase than staging (seed users 401 there) — use the **Preview** branch URL for staging-data verification.
- **[UX] Comment UI built but never mounted (2026-06-16):** `components/comments/{CommentPanel,CommentInput,CommentThread,CommentItem}` are imported by NO file under `app/`. `app/(dashboard)/videos/[id]/page.tsx` passes only `player` to `MobilePlayerLayout` (unused `panel`/`input` slots), so the authed video page has zero comment thread/input — core comment loop unreachable in-browser (the guest page renders comments fine). Grep `app/` for a component's import before assuming a feature is wired.
- **[Process] Mocked-only suites hide live breakage (2026-06-16):** First live Playwright drive of staging found 3 P1s (both dashboards, playback, comment UI) that the fully-mocked unit suite passed green. A thin live smoke test (dashboard query, playback-url, comment render) against a preview would catch this class. See `STAGING_WALKTHROUGH_REPORT.md`.
- **[Linear] A markdown task with no Linear issue = permanent sync-check "error" that sync-fix can't repair (2026-06-16):** `S2-WIRE-001` was added to `tasks/sprint-2.md` during S2 closeout but never got a Linear issue created, so `sync-check` reported `? (error)` (not `✗ DRIFTED`) and `sync-fix` said "Nothing to fix" — `sync-fix` only *pushes status to issues that already exist*; it never *creates* them. Fix: create the issue (mirror an existing sprint issue — same team `Resolvelabs`, project, `size:*` label, title leading with the exact `TASK_ID` since `update-linear-task.sh` matches `title.upper().startswith(TASK_ID)` via `searchIssues`), set it straight to `Done`. Gotcha: Linear's `searchIssues` full-text index lags new issues by up to a few minutes, so `sync-check` keeps showing the error until the index catches up — the issue is real, just not yet searchable. Whenever you add a task row to a sprint file, create its Linear issue in the same step.
- **[Ralph] Unbounded loop from a model-disabled `/pr-fix` (2026-06-16):** CLAUDE.md said "auto-run `/pr-fix`", but the skill is `disable-model-invocation: true`, so the model couldn't invoke it and started the raw `ralph-loop:ralph-loop` primitive instead — unbounded (`max_iterations:0`, `completion_promise:null`), uncancellable, had to be removed by hand. Fix: CLAUDE.md now points the model to *read & follow* the bounded SKILL.md, and forbids starting any Ralph loop without both `--max-iterations` and `--completion-promise`. Also unified `pr-fix-loop.md`'s four exit promises to one token (`RALPH DONE`) because the stop-hook only literal-matches a single completion-promise string.
- **[CI/Worktrees] `type-check && lint` is NOT enough — worktree agents MUST run `pnpm build` before pushing (2026-06-17):** Two S3 PRs (#104 webhook, #105 cron) passed the agents' local `pnpm type-check && pnpm lint` but FAILED CI's `pnpm build`. Two distinct causes, both invisible to `tsc --noEmit`: (1) **Next.js route-export validation** — `app/api/cron/storage-reconcile/route.ts` did `export async function reconcileStorage(...)`; a route module may only export reserved fields (GET/POST/maxDuration/…), so `next build` errors `"reconcileStorage" is not a valid Route export field`. `tsc` doesn't enforce this. Fix: move helpers to a `lib/*.ts` and import them. (2) **Symlinked `node_modules` masks missing manifest deps** — the worktree's `node_modules` is symlinked to main's, which had `stripe` installed, so local `tsc` resolved `import 'stripe'` fine; but CI does a clean `pnpm install` from the lockfile, and `stripe` was missing from package.json/pnpm-lock on the branch → `Cannot find module 'stripe'`. Rule: any worktree agent touching a `route.ts` export or a new import MUST run `pnpm build` (the real CI gate) before pushing, not just type-check+lint.
- **[Git] S3-BILLING-001 marked "done" but never merged to main → main lacks the `stripe` dependency (2026-06-17):** The S3-BILLING-001 commit (9312933, adds `stripe@^22.2.1` to package.json + docs) lives on `chore/claude-config-automations`, not `main`. Feature branches cut from `main` therefore have no `stripe` dep; builds only pass locally because the symlinked `node_modules` still has it (see CI entry above). Stopgap: PR #104 self-carries the exact stripe manifest+lock ported from 9312933 (identical add → merges cleanly when BILLING-001 lands). Real fix pending: land S3-BILLING-001 (stripe dep + `docs/stripe-setup.md`) on main. "Done" in tasks/Linear ≠ "on main" — verify `git show main:package.json` before assuming a dep exists in the base. **RESOLVED 2026-06-18 (PR #102 merged):** `main` now carries `stripe@^22.2.1`, `lib/stripe.ts`, `lib/feature-flags.ts`, `docs/stripe-setup.md`, and `tasks/sprint-3.md`. #104's redundant stripe-dep commit auto-dropped on rebase ("patch contents already upstream"). The "verify against `git show main:…` before assuming" rule stands.
- **[Git/Worktrees] `.gitignore` `node_modules/` does NOT match a node_modules SYMLINK (2026-07-02):** worktree agents symlink main's node_modules (per the parallel-agents entry); the trailing-slash pattern only matches directories, so one agent's `git add`-everything committed the symlink and broke CI's clean install (`ENOTDIR: mkdir node_modules`). Fixed: pattern is now `node_modules` (no slash — matches both). Rule for agents: add specific paths, never `git add -A` from a worktree root.
- **[Sentry] `beforeSend` does NOT scrub transaction events — secrets leaked via tracing (2026-07-02, RESOLVED):** with `tracesSampleRate > 0`, requestDataIntegration attaches url/headers/cookies/body to EVERY event, and transaction events only pass through `beforeSendTransaction`. Before PR #122, ~10% of requests to token-bearing routes shipped the raw guest token (request.url) and `sb-access-token` cookie to Sentry — no captureException needed. Fix: `lib/sentry-scrub.ts` `scrubSentryEvent` wired to BOTH `beforeSend` AND `beforeSendTransaction` on both runtimes (nodejs+edge), dropping cookies/body/query_string + auth-class headers and redacting `token`/`code` URL segments. Rule: any new secret-in-URL route must be covered by the scrubber's regexes, and any new Sentry event class (e.g. Next 15 `onRequestError`) must route through it.
- **[CI/Node] `pnpm test` globs need Node 21+ — CI's Node 20 failed with "Could not find '**/*.test.ts'" (2026-07-02):** the `test` script passes quoted globs to `tsx --test`; Node's test runner only expands them from v21. Worked locally (Node 25), failed on CI (Node 20). Fix: CI bumped to Node 22 LTS (Node 20 is EOL since 2026-04). Rule: local-green ≠ CI-green when node versions differ — check `node --version` against ci.yml's `node-version` when a script behaves differently in CI.
- **[Billing] Plan tiers now have ONE source of truth: `lib/plans.ts` (2026-06-18):** every tier number (agent seats, storage bytes via `N*GiB`, pence prices, Stripe `lookup_key`s) lives only in `PLANS`; `plan-gates`/`stripe`/`billing`/checkout/UI derive from it. Two traps when touching this: (1) **the price→plan reverse map (`LOOKUP_KEY_TO_PLAN`) MUST cover both the monthly AND annual lookup_key of every paid plan** — covering monthly only silently downgrades every *annual* subscriber to freemium on their next `subscription.updated`. (2) Webhook resolves price→plan via `getPlanFromPrice(price)` = lookup_key → `LEGACY_PRICE_ID_TO_PLAN` (the 8 old hardcoded IDs, **never delete** — they grandfather existing payers whose archived prices have no lookup_key) → freemium. The migration `0021` CASE bytes are the one allowed hand-authored copy (SQL can't import TS) and must equal `N*GiB` exactly. Stripe catalogue is managed by `scripts/setup-stripe.ts` (mode by key prefix, idempotent, archives old prices) + `scripts/verify-plan-consistency.ts` (drift guard — local/pre-deploy only, needs a Stripe secret so it can't be a CI step).

## Environments

Three envs: `hudo-dev`, `hudo-staging`, `hudo-prod`. Preview = main + feature branches (staging); Production = `production` branch (reserved). Never deploy to production without approval. Full details: [docs/vercel-setup.md](docs/vercel-setup.md).

## Roles & Permissions

`owner > admin_agent > agent > talent > guest`
Talent: can only see own videos, set status to `pending_review` only.
Guest: read-only via signed link, no Supabase access.

## Sprints

- **S0** — Infrastructure & Auth ✅ done
- **S1** — Upload, Player, Comments, Versioning ✅ done
- **S2** — Dashboards, Notifications, Guest Links ✅ done (15/15)
- **S3** — Billing, Compliance, Security Hardening ✅ done (15/15; erasure live-verified on hudo-dev. Open follow-ups from the R2 audit, separate PRs: tighten R2 CORS `AllowedOrigins` — currently allows `https://*.vercel.app`, any Vercel project — and r2.dev-toggle dashboard sign-off pre-launch; see `docs/r2-security-audit.md`)
- **S4** — Accessibility, PWA, Launch Prep ← next

> Sprint markers above are a static summary; `node orchestrate.js status` is the live source of truth.

## Linear Sprint Tracker

Status synced by `orchestrate.js start/review/done/blocked` and by GitHub Actions; manual: `sync-check`, `sync-fix`. `sync-check` also flags branches merged into release refs (`main`, `production`, `preview/wave-*`) but not marked done, and `sync-fix` auto-promotes them. Full automation table and workflow states: [orchestrate.md](orchestrate.md).

## Context budget

Keep CLAUDE.md to durable rules and minimal pointers; long reference lives in [orchestrate.md](orchestrate.md) and `docs/`. Prefer MEMORY.md for session-specific notes and CLAUDE.md for lasting project rules; keep MEMORY concise and link to docs instead of pasting runbooks.
