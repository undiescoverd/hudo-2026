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
  update-baserow-task.sh  # Update Baserow task status
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
- Do not start a task while any `BLOCKED_BY` task is not `done`

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

## Baserow Sprint Tracker

All sprint tasks are tracked live in Baserow (workspace: Hudo → database: Hudo Sprint Tracker, table ID 849304).

**When starting a task:**
```bash
./scripts/update-baserow-task.sh <TASK_ID> "In Progress"
```

**When a task is complete (PR merged / acceptance criteria met):**
```bash
./scripts/update-baserow-task.sh <TASK_ID> "Done"
```

**When a PR is open and in review:**
```bash
./scripts/update-baserow-task.sh <TASK_ID> "In Review"
```

Credentials and table ID are in `.env.baserow`. A PostToolUse hook in `.claude/settings.json` attempts auto-update on Bash output — but always call the script explicitly when completing tasks.

View tracker at: https://app.baserow.io (Hudo workspace → Hudo Sprint Tracker → Sprint Tasks)
