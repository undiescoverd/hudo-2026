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

## Deployment

### Vercel Setup

The project is deployed on Vercel and automatically linked to the GitHub repository `undiescoverd/hudo-2026`.

**Deployment triggers:**
- **Preview deployments** are triggered automatically on every pull request
- **Production deployment** is triggered on merge to `main`

### Environment Variable Groups

Vercel is configured with three isolated environment variable groups corresponding to the three Hudo environments:

#### 1. Development (`hudo-dev`)
For preview deployments and development testing. Configuration deployed to `hudo-dev.vercel.app`.

**Variables to set:**
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase API endpoint for hudo-dev
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key (public; safe for browser)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (server-side only)
- `R2_ACCESS_KEY_ID` — Cloudflare R2 API key ID
- `R2_SECRET_ACCESS_KEY` — Cloudflare R2 secret key
- `R2_ACCOUNT_ID` — Cloudflare account ID
- `R2_BUCKET_NAME` — R2 bucket name (e.g., `hudo-dev`)
- `R2_ENDPOINT` — R2 S3 endpoint URL
- `UPSTASH_REDIS_REST_URL` — Upstash Redis REST API URL
- `UPSTASH_REDIS_REST_TOKEN` — Upstash Redis token
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — Stripe test-mode publishable key
- `STRIPE_SECRET_KEY` — Stripe test-mode secret key
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret
- `RESEND_API_KEY` — Resend email service API key
- `RESEND_FROM_EMAIL` — Sender email address (e.g., `noreply@hudo.io`)
- `NEXT_PUBLIC_SENTRY_DSN` — Sentry client-side DSN
- `SENTRY_DSN` — Sentry server-side DSN
- `SENTRY_AUTH_TOKEN` — Sentry auth token for source map uploads
- `SENTRY_ORG` — Sentry organization slug
- `SENTRY_PROJECT` — Sentry project slug
- `NEXT_PUBLIC_POSTHOG_KEY` — PostHog API key
- `NEXT_PUBLIC_POSTHOG_HOST` — PostHog host (default: `https://app.posthog.com`)
- `NEXT_PUBLIC_APP_URL` — Public URL (e.g., `https://hudo-dev.vercel.app`)
- `PLAYWRIGHT_TEST_URL` — Base URL for E2E tests (set in GitHub Actions, not Vercel)
- `E2E_TEST_AGENCY_EMAIL` — Pre-seeded test account email (set in GitHub Actions)
- `E2E_TEST_AGENCY_PASSWORD` — Pre-seeded test account password (set in GitHub Actions)
- `E2E_GUEST_TEST_TOKEN` — Pre-seeded guest link token (set in GitHub Actions)
- `E2E_AGENCY_A_EMAIL` — Multi-tenant test account A (set in GitHub Actions)
- `E2E_AGENCY_A_PASSWORD` — Multi-tenant test account A password (set in GitHub Actions)
- `E2E_AGENCY_B_EMAIL` — Multi-tenant test account B (set in GitHub Actions)
- `E2E_AGENCY_B_PASSWORD` — Multi-tenant test account B password (set in GitHub Actions)

#### 2. Preview (`hudo-staging`)
For staging/UAT before production. Configuration deployed to `hudo-staging.vercel.app`.

**Variables to set:**
Same as Development, but using credentials for the `hudo-staging` Supabase project and R2 bucket.

#### 3. Production (`hudo-prod`)
Live production environment. Configuration deployed to `hudo.io`.

**Variables to set:**
Same as Development, but using credentials for the `hudo-prod` Supabase project and R2 bucket, with production Stripe keys.

### Setting Environment Variables

Environment variables are managed exclusively through the Vercel dashboard. **Never commit `.env.local` or store secrets in version control.**

To set variables in Vercel:
1. Go to https://vercel.com/dashboard
2. Select the Hudo project
3. Navigate to Settings → Environment Variables
4. Add variables for each group (Development, Preview, Production)
5. Specify which deployment environments each variable applies to

### Configuration Files

- `vercel.json` — Vercel project configuration (build command, framework, regions)
- `.env.example` — Reference of all required environment variables and their descriptions

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for branching conventions and the git worktree workflow.
