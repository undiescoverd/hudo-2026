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

```
orchestrate.js         # Build orchestrator — node orchestrate.js <cmd>
orchestrate.md         # Orchestrator documentation and workflow guide
tasks/sprint-0.md      # Sprint 0 task list (STATUS tracked here)
tasks/sprint-N.md      # Future sprint task lists (added per sprint)
scripts/
  update-linear-task.sh   # Update Linear task status
  linear-id-map.json      # Maps TASK_ID → Linear UUID
docs/
  hudo-prd-v1.1.md        # Product requirements
  hudo-sprint-plan.md     # Full sprint plan v1.2 (task reference)
  hudo-build-foundation.md # Schema, RLS policies, storage spec
# Created during Sprint 0 build:
lib/storage.ts         # Single interface for all R2 ops
lib/redis.ts           # Upstash client — rate limiting only
supabase/migrations/   # SQL migrations
tests/rls/             # RLS policy test suite (runs in CI)
```

## Orchestrator Workflow

```bash
node orchestrate.js status              # Sprint progress
node orchestrate.js next                # Unblocked tasks + parallelism waves
node orchestrate.js prompt S0-INFRA-001 # Full agent prompt (includes model)
node orchestrate.js start <TASK_ID>     # Set in_progress
node orchestrate.js review <TASK_ID>    # Set in_review (on PR open)
node orchestrate.js done <TASK_ID>      # Set done, shows newly unblocked
node orchestrate.js gate sprint-0       # Verify sprint gate checklist
```

Task format requires: `TASK_ID`, `TITLE`, `BRANCH`, `MODEL`, `STATUS`, `BLOCKED_BY`, `ACCEPTANCE_CRITERIA`, `FILES`, `NOTES`. Model defaults to `sonnet-4.6` if omitted.

## Agent Rules

- Only create/modify files listed in task `FILES`
- Write minimum code to satisfy acceptance criteria — nothing more
- Write tests for every acceptance criterion
- Do not add dependencies without flagging first
- Commit → push branch → open PR → run `orchestrate.js review`
- After opening a PR, always run `/pr-fix` to start the Ralph Loop — do not wait for manual invocation
- Before committing, run `pnpm format:check && pnpm type-check && pnpm lint` to catch CI issues locally
- Do not start a task while any `BLOCKED_BY` task is not `done`
- After completing work, update CLAUDE.md with any learnings (new patterns, gotchas, tooling changes). Keep it concise — remove stale info, never duplicate, only add what future agents genuinely need. Prefer updating MEMORY.md for session-specific details and CLAUDE.md for durable project rules.

## Code Quality

- **Pre-commit hooks** via Husky + lint-staged. Staged files are auto-formatted (Prettier) and linted (ESLint) on every commit. Config in `package.json` under `lint-staged`.

## Environments

Three fully isolated environments: `hudo-dev`, `hudo-staging`, `hudo-prod` — each with own Supabase project, R2 bucket, Vercel env group, Stripe key. No production secrets in dev.

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

All sprint tasks are tracked live in Linear. The orchestrator syncs statuses automatically.

**Automated sync (no manual action needed):**
- `orchestrate.js start/review/done/blocked` → syncs to Linear with 1 retry
- Push to `feat/s*-*` branch → GitHub Actions marks In Progress (only from Backlog/Todo)
- PR open → GitHub Actions marks In Review + patches PR description
- PR merge → GitHub Actions marks Done
- Daily cron (08:00 UTC) → `linear-sync-check.yml` detects drift, auto-fixes, notifies Slack

**Manual sync commands:**
```bash
node orchestrate.js sync-check          # Compare markdown vs Linear (read-only)
node orchestrate.js sync-fix            # Push markdown statuses to Linear for drifted tasks
./scripts/update-linear-task.sh --status <TASK_ID>  # Query a task's Linear state
```

**Linear workflow states:** Backlog, Todo, In Progress, In Review, Blocked, Done, Canceled, Duplicate

`LINEAR_API_KEY` lives in `.env.baserow`. The `.github/workflows/linear-update.yml` and `linear-sync-check.yml` workflows use the `LINEAR_API_KEY` GitHub Actions secret.
