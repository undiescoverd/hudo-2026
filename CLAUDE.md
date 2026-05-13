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

## Environments

Three envs: `hudo-dev`, `hudo-staging`, `hudo-prod`. Preview = main + feature branches (staging); Production = `production` branch (reserved). Never deploy to production without approval. Full details: [docs/vercel-setup.md](docs/vercel-setup.md).

## Roles & Permissions

`owner > admin_agent > agent > talent > guest`
Talent: can only see own videos, set status to `pending_review` only.
Guest: read-only via signed link, no Supabase access.

## Sprints

- **S0** — Infrastructure & Auth (current)
- **S1** — Upload, Player, Comments, Versioning
- **S2** — Dashboards, Notifications, Guest Links
- **S3** — Billing, Compliance, Security Hardening
- **S4** — Accessibility, PWA, Launch Prep

## Linear Sprint Tracker

Status synced by `orchestrate.js start/review/done/blocked` and by GitHub Actions; manual: `sync-check`, `sync-fix`. `sync-check` also flags branches merged into release refs (`main`, `production`, `preview/wave-*`) but not marked done, and `sync-fix` auto-promotes them. Full automation table and workflow states: [orchestrate.md](orchestrate.md).

## Context budget

Keep CLAUDE.md to durable rules and minimal pointers; long reference lives in [orchestrate.md](orchestrate.md) and `docs/`. Prefer MEMORY.md for session-specific notes and CLAUDE.md for lasting project rules; keep MEMORY concise and link to docs instead of pasting runbooks.
