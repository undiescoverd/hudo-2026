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
| Package manager | pnpm, Node 20 LTS |

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

> **Unit tests run locally only — still no CI step:** `pnpm test` now exists (`tsx --test`, 42 files / ~649 cases across `app/`, `lib/`, `components/`, root). It is **not** wired into CI by decision — CI still covers Lint/Type-check/Build + RLS only, so don't assume a green CI ran the unit suite. Two **stale source-pattern tests fail** on a clean run (their regexes don't match the correct current source, not real bugs): `components/guest/GuestComments.test.tsx:43` (regex matches the file's own doc comment) and `app/api/cron/notifications/route.test.ts:26` (single-line regex can't match the multi-line `timingSafeEqual` auth check). Fix those two before wiring `pnpm test` into CI.

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
- After opening a PR, always run `/pr-fix` to start the Ralph Loop — do not wait for manual invocation
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

- **Pre-commit hooks** via Husky + lint-staged. Staged files are auto-formatted (Prettier) and linted (ESLint) on every commit. Config in `package.json` under `lint-staged`.
- **Claude hooks** in `.claude/settings.json`: PreToolUse blocks any Edit/Write to `.env*` files (exit 2); PostToolUse runs `pnpm type-check` after any `.ts`/`.tsx` edit and surfaces the last 20 lines.

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
- **[CSP] Playback blocked because `media-src` omits R2 (2026-06-16, RESOLVED + live-verified):** `next.config.js` allowed R2 in `connect-src` (upload PUT works) but `media-src 'self' blob:` blocked the `<video>` loading the signed R2 URL → playback dead on staging. **Fix (PR #97):** allowlisted `https://*.r2.cloudflarestorage.com` in `media-src` (one global CSP at `/(.*)` → covers both authed `/videos/[id]` and guest `/guest/[token]` at once). Rejected the proxy/stream-through-app alternative (egress + HTTP-Range cost; signed-URL is the de-facto architecture in code+tests). Rule: any browser-facing R2 resource needs its host in **both** `connect-src` (fetch/XHR) **and** `media-src` (`<video>`/`<audio>`) — independent directives. **Live-verified** on the branch preview (Playwright): authed + guest video both play (`readyState 4`, `currentTime` advances, no error), console clean of `media-src` violations. Guard: `next.config.test.ts` asserts the R2 host stays in both — but **CI runs no `node:test` suites** (only Lint/Build + RLS), so the guard only fires when run locally; don't treat it as CI-enforced.
- **[Seed] Staging "Staging Test Reel" video has no R2 object (2026-06-16, RESOLVED):** seed video `7cb31754-187e-4f68-9a76-6a3a1973e080` (`r2_key seed/staging/7cb31754…/v1.mp4`) had a DB row but the file was never uploaded → GET `403 NoSuchKey` → `<video>` format error. Seed-data gap, not a playback bug — `scripts/seed-staging.mjs` created the row inside the `if (!video)` guard without ever writing bytes. **Fix (`chore/seed-staging-r2-upload`):** the seed now bootstraps a stable seed-owned asset `seed/staging/_assets/sample-v1.mp4` once (`--bootstrap`, server-side copy from the crown-jewel `55c07ab0…` upload — no repo binary) and, **outside** the idempotency guard, `HeadObject`/`CopyObject`s it onto the video's `r2_key` + syncs `file_size_bytes`/`duration_seconds`. Backfill re-reads `active_version_id` from the DB (the fresh-create path never refreshes the in-memory `video`, so verification was blind to creation). **Live-verified** (Playwright, preview): the seed video now plays (`readyState 4`, `error null`, `currentTime` advances, decoded 320×240). Run: `node --env-file=.env.staging scripts/seed-staging.mjs` (no bucket override needed since the `.env.staging` reconcile below).
- **[R2/Env] `.env.staging` drifted from the Vercel preview env (2026-06-16, RECONCILED):** the deployed staging app signs upload/playback against bucket **`hudo-staging`** (crown-jewel + seed signed URLs both hit `hudo-staging.…r2.cloudflarestorage.com`); the Vercel **preview** env's canonical `R2_BUCKET_NAME` is already `hudo-staging`. But the local `.env.staging` had drifted to a stale `R2_BUCKET_NAME="hudo-dev"` **and** carried a literal `\n` on most values (a bad-paste artifact; `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, etc.). **Fix:** `vercel env pull .env.staging --environment=preview --yes` restored clean, artifact-free canonical values for the whole file — so **no `R2_BUCKET_NAME` override is needed locally anymore** (seed runs plain). Verified HeadObject crown-jewel = 200 in `hudo-staging` / 404 in `hudo-dev`. **Two traps:** (1) never strip a trailing literal `\n` from a dotenv file with a regex whose trailing class includes `\s*$` — `\s` matches the line-terminator newline and merges lines, corrupting the file (it ate 16 lines here); `vercel env pull` is the canonical recovery since the file is "Created by Vercel CLI". (2) the **production**-target Vercel domain points at a *different* Supabase than staging (seed users 401 there) — use the **Preview** branch URL for staging-data verification.
- **[UX] Comment UI built but never mounted (2026-06-16):** `components/comments/{CommentPanel,CommentInput,CommentThread,CommentItem}` are imported by NO file under `app/`. `app/(dashboard)/videos/[id]/page.tsx` passes only `player` to `MobilePlayerLayout` (unused `panel`/`input` slots), so the authed video page has zero comment thread/input — core comment loop unreachable in-browser (the guest page renders comments fine). Grep `app/` for a component's import before assuming a feature is wired.
- **[Process] Mocked-only suites hide live breakage (2026-06-16):** First live Playwright drive of staging found 3 P1s (both dashboards, playback, comment UI) that the fully-mocked unit suite passed green. A thin live smoke test (dashboard query, playback-url, comment render) against a preview would catch this class. See `STAGING_WALKTHROUGH_REPORT.md`.
- **[Linear] A markdown task with no Linear issue = permanent sync-check "error" that sync-fix can't repair (2026-06-16):** `S2-WIRE-001` was added to `tasks/sprint-2.md` during S2 closeout but never got a Linear issue created, so `sync-check` reported `? (error)` (not `✗ DRIFTED`) and `sync-fix` said "Nothing to fix" — `sync-fix` only *pushes status to issues that already exist*; it never *creates* them. Fix: create the issue (mirror an existing sprint issue — same team `Resolvelabs`, project, `size:*` label, title leading with the exact `TASK_ID` since `update-linear-task.sh` matches `title.upper().startswith(TASK_ID)` via `searchIssues`), set it straight to `Done`. Gotcha: Linear's `searchIssues` full-text index lags new issues by up to a few minutes, so `sync-check` keeps showing the error until the index catches up — the issue is real, just not yet searchable. Whenever you add a task row to a sprint file, create its Linear issue in the same step.

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
- **S3** — Billing, Compliance, Security Hardening ← next (not yet in `tasks/`)
- **S4** — Accessibility, PWA, Launch Prep

> Sprint markers above are a static summary; `node orchestrate.js status` is the live source of truth.

## Linear Sprint Tracker

Status synced by `orchestrate.js start/review/done/blocked` and by GitHub Actions; manual: `sync-check`, `sync-fix`. `sync-check` also flags branches merged into release refs (`main`, `production`, `preview/wave-*`) but not marked done, and `sync-fix` auto-promotes them. Full automation table and workflow states: [orchestrate.md](orchestrate.md).

## Context budget

Keep CLAUDE.md to durable rules and minimal pointers; long reference lives in [orchestrate.md](orchestrate.md) and `docs/`. Prefer MEMORY.md for session-specific notes and CLAUDE.md for lasting project rules; keep MEMORY concise and link to docs instead of pasting runbooks.
