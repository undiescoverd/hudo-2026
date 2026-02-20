# Hudo

Video review platform for talent agencies. Frame.io-style: upload → timestamped comments → resolve → approve.

## Prerequisites

- Node.js 20 LTS
- pnpm 9+
- Access to Supabase, Cloudflare R2, and other third-party services (see `.env.example`)

## Local Setup

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd hudo
pnpm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in the values for each variable. See `.env.example` for descriptions of each.

You will need:

- A Supabase project (the `hudo-dev` project for local work)
- A Cloudflare R2 bucket (`hudo-dev`)
- An Upstash Redis database
- Stripe test-mode keys
- Resend API key
- Sentry and PostHog project DSNs

### 3. Run the development server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Type-check and lint

```bash
pnpm type-check
pnpm lint
pnpm format:check
```

## Project Structure

```
app/              # Next.js App Router — pages, layouts, API routes
components/       # Shared UI components (Shadcn UI base)
lib/              # Shared utilities (storage, redis, supabase clients)
supabase/
  migrations/     # SQL migrations — applied via Supabase CLI
tests/
  rls/            # Row-level security policy tests
tasks/            # Sprint task lists
docs/             # PRD, sprint plan, build foundation
scripts/          # Dev and CI helper scripts
```

## Orchestrator

Sprint progress and task management:

```bash
node orchestrate.js status   # Current sprint status
node orchestrate.js next     # Next unblocked tasks
node orchestrate.js prompt <TASK_ID>  # Full agent prompt for a task
```

See `orchestrate.md` for full documentation.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for branching conventions and the git worktree workflow.
