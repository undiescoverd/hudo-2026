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
- After completing work, update CLAUDE.md with any learnings (new patterns, gotchas, tooling changes). Keep it concise — remove stale info, never duplicate, only add what future agents genuinely need. Prefer updating MEMORY.md for session-specific details and CLAUDE.md for durable project rules.

## Code Quality

- **Pre-commit hooks** via Husky + lint-staged. Staged files are auto-formatted (Prettier) and linted (ESLint) on every commit. Config in `package.json` under `lint-staged`.
- **Claude hooks** in `.claude/settings.json`: PreToolUse blocks any Edit/Write to `.env*` files (exit 2); PostToolUse runs `pnpm type-check` after any `.ts`/`.tsx` edit and surfaces the last 20 lines.

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

Status synced by `orchestrate.js start/review/done/blocked` and by GitHub Actions; manual: `sync-check`, `sync-fix`. Full automation table and workflow states: [orchestrate.md](orchestrate.md).

## Context budget

Keep CLAUDE.md to durable rules and minimal pointers; long reference lives in [orchestrate.md](orchestrate.md) and `docs/`. Prefer MEMORY.md for session-specific notes and CLAUDE.md for lasting project rules; keep MEMORY concise and link to docs instead of pasting runbooks.
