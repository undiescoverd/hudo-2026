# Sprint 0 — Infrastructure & Schema
**Status: Ready for execution**
**Gate:** Local dev runs end-to-end. Schema applied to dev, staging, and prod. Vercel preview deploys on PR. CI passes on an empty commit.

---

## Tasks

---

- [x] **S0-INFRA-001** — Initialise repository and Next.js project

TASK_ID: S0-INFRA-001
TITLE: Initialise repository and Next.js project
BRANCH: feat/s0-infra-001-repo-init
MODEL: haiku-4.5
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Next.js 14 project created with App Router and TypeScript strict mode
  - Shadcn UI initialised (all default components available)
  - Tailwind CSS configured
  - ESLint and Prettier configured with rules enforced in CI
  - `.env.example` lists all required environment variables with descriptions, no values
  - `README.md` describes local setup steps
  - Git worktree workflow documented in `CONTRIBUTING.md`
  - Project runs locally with `pnpm dev` and renders default page
FILES:
  - package.json
  - next.config.js
  - tsconfig.json
  - tailwind.config.ts
  - .eslintrc.json
  - .prettierrc
  - .env.example
  - README.md
  - CONTRIBUTING.md
NOTES: Use pnpm as package manager. Node 20 LTS. Do not install any feature dependencies yet — only project scaffolding.

---

- [ ] **S0-INFRA-002** — Configure GitHub Actions CI

TASK_ID: S0-INFRA-002
TITLE: Configure GitHub Actions CI pipeline
BRANCH: feat/s0-infra-002-ci
MODEL: haiku-4.5
STATUS: in_progress
BLOCKED_BY: S0-INFRA-001
ACCEPTANCE_CRITERIA:
  - CI runs on every PR and push to main
  - Steps: install dependencies, lint, type-check, run tests
  - CI passes on an empty test suite (no tests yet)
  - Branch protection rule on main documented in README (must be enabled manually in GitHub settings)
FILES:
  - .github/workflows/ci.yml
NOTES: Use pnpm in CI. Cache pnpm store between runs.

---

- [ ] **S0-INFRA-003** — Configure Vercel deployment

TASK_ID: S0-INFRA-003
TITLE: Configure Vercel project and environment variable structure
BRANCH: feat/s0-infra-003-vercel
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: S0-INFRA-001
ACCEPTANCE_CRITERIA:
  - Vercel project created and linked to GitHub repo
  - Preview deployments trigger on PR
  - Production deployment triggers on merge to main
  - Three Vercel environment variable groups configured: development, preview, production
  - All variables from .env.example represented in each group (values can be placeholder for now)
  - Deployment documented in README
FILES:
  - vercel.json (if needed for config)
  - README.md (updated)
NOTES: Do not store any secrets in the repo. Environment variables are set via Vercel dashboard.

---

- [ ] **S0-INFRA-004** — Configure security headers

TASK_ID: S0-INFRA-004
TITLE: Add security headers to Next.js config
BRANCH: feat/s0-infra-004-security-headers
MODEL: sonnet-4.6
STATUS: in_progress
BLOCKED_BY: S0-INFRA-001
ACCEPTANCE_CRITERIA:
  - All five required headers present on every response (see PRD Section 5.5)
  - CSP allows: self, Supabase, Stripe, PostHog, Sentry
  - Headers verified with curl on local dev and Vercel preview
  - Session cookies configured: SameSite=Lax; Secure; HttpOnly
FILES:
  - next.config.js
NOTES: CSP must not block Supabase Realtime websocket (wss://). Test with browser devtools network tab.

---

- [ ] **S0-DB-001** — Provision Supabase environments

TASK_ID: S0-DB-001
TITLE: Create and configure Supabase dev, staging, and production projects
BRANCH: feat/s0-db-001-supabase-envs
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: S0-INFRA-001
ACCEPTANCE_CRITERIA:
  - Three Supabase projects created: hudo-dev, hudo-staging, hudo-prod
  - Each project has its connection string, anon key, and service role key stored in the correct Vercel environment group
  - RLS is enabled at the project level for all three environments
  - Each project has email auth enabled; social providers disabled
  - Supabase CLI configured locally and connected to hudo-dev
FILES:
  - supabase/config.toml
  - .env.example (updated with Supabase variable names)
NOTES: Service role key must never appear in client-side code or be committed to git. Use Supabase CLI for local development linked to hudo-dev.

---

- [ ] **S0-DB-002** — Write and apply initial schema migration

TASK_ID: S0-DB-002
TITLE: Write initial schema migration and apply to all three environments
BRANCH: feat/s0-db-002-schema
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: S0-DB-001
ACCEPTANCE_CRITERIA:
  - Migration file covers all 11 tables defined in PRD Section 4 and Build Foundation Part 2
  - All indexes from PRD Section 4.3 are created
  - RLS is enabled on all tables
  - All RLS policies from Build Foundation Part 2 are applied
  - Migration applied successfully to hudo-dev, hudo-staging, and hudo-prod
  - Supabase CLI can run migration from scratch against a clean project: `supabase db reset` succeeds
  - No table, column, or policy is missing relative to the spec
FILES:
  - supabase/migrations/0001_initial_schema.sql
NOTES: Copy the SQL from the Build Foundation Document exactly. Do not invent columns or tables not in the spec. The migration must be idempotent where possible.

---

- [ ] **S0-DB-003** — Write RLS test suite scaffold

TASK_ID: S0-DB-003
TITLE: Create RLS test suite that will enforce policy coverage throughout the build
BRANCH: feat/s0-db-003-rls-tests
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: S0-DB-002
ACCEPTANCE_CRITERIA:
  - Test suite in `tests/rls/` using Supabase's `pgTAP` or equivalent
  - Tests cover: cross-agency data access is impossible, talent cannot read other talent's videos, guests have no Supabase access, audit_log cannot be updated or deleted via client
  - Tests run in CI via GitHub Actions
  - All tests pass against the current schema
  - A comment in each test file explains which PRD policy it is enforcing
FILES:
  - tests/rls/agencies.test.sql (or .ts)
  - tests/rls/videos.test.sql
  - tests/rls/comments.test.sql
  - tests/rls/audit_log.test.sql
  - .github/workflows/ci.yml (updated to run RLS tests)
NOTES: Any future deletion of an RLS policy must cause at least one test here to fail. That is the purpose of this suite.

---

- [ ] **S0-STORAGE-001** — Configure Cloudflare R2 buckets

TASK_ID: S0-STORAGE-001
TITLE: Create and configure R2 buckets for all three environments
BRANCH: feat/s0-storage-001-r2-buckets
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: S0-INFRA-001
ACCEPTANCE_CRITERIA:
  - Three R2 buckets created: hudo-dev, hudo-staging, hudo-prod
  - All buckets: private, no public bucket policy, no public fallback
  - CORS configured on all buckets: allow PUT uploads from app domain only
  - Object versioning enabled on all buckets
  - R2 API credentials (access key, secret key, account ID, bucket name) stored in correct Vercel environment groups
  - Verified: direct unsigned R2 URL returns 403
  - Verified: CORS rejects request from non-app domain
FILES:
  - docs/r2-setup.md (documents bucket config and CORS policy for reproducibility)
  - .env.example (updated with R2 variable names)
NOTES: CORS policy: `AllowedOrigins: [https://hudo.app, http://localhost:3000]`, `AllowedMethods: [PUT]`, `AllowedHeaders: [Content-Type]`. Do not allow GET in CORS — playback goes through the signing proxy, not CORS.

---

- [ ] **S0-STORAGE-002** — Build R2 signing proxy (playback URL generation)

TASK_ID: S0-STORAGE-002
TITLE: Implement signing proxy API route for video playback URL generation
BRANCH: feat/s0-storage-002-signing-proxy
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: S0-DB-002, S0-STORAGE-001
ACCEPTANCE_CRITERIA:
  - `GET /api/videos/:videoId/playback-url` returns a signed R2 URL with 15-minute expiry
  - Route validates: requesting user is authenticated and has access to the video (via memberships)
  - Direct R2 object URL is never returned to the client — only the signed URL
  - Unauthenticated requests return 401
  - Requests for videos the user cannot access return 403
  - Signed URL expires after 15 minutes (verified with manual test)
FILES:
  - app/api/videos/[videoId]/playback-url/route.ts
  - lib/r2.ts (R2 client and signing utility)
NOTES: Use AWS SDK v3 `@aws-sdk/client-s3` with `getSignedUrl` — R2 is S3-compatible. The R2 object URL must not appear in any response body, log, or error message.

---

- [ ] **S0-INFRA-005** — Configure Sentry

TASK_ID: S0-INFRA-005
TITLE: Install and configure Sentry for error monitoring
BRANCH: feat/s0-infra-005-sentry
MODEL: haiku-4.5
STATUS: in_progress
BLOCKED_BY: S0-INFRA-001
ACCEPTANCE_CRITERIA:
  - Sentry Next.js SDK installed and configured
  - Separate Sentry projects or DSNs for dev/staging/prod
  - Errors captured in both client and server components
  - Source maps uploaded on production build
  - A deliberate thrown error in a test route confirms Sentry receives it
  - Sentry DSN is an environment variable, not hardcoded
FILES:
  - sentry.client.config.ts
  - sentry.server.config.ts
  - sentry.edge.config.ts
  - next.config.js (updated with Sentry webpack plugin)
  - .env.example (updated)
NOTES: Do not enable Sentry session replay in MVP — it captures video frames and has GDPR implications.

---

- [ ] **S0-INFRA-006** — Configure PostHog

TASK_ID: S0-INFRA-006
TITLE: Install PostHog with cookie consent gate
BRANCH: feat/s0-infra-006-posthog
MODEL: sonnet-4.6
STATUS: in_progress
BLOCKED_BY: S0-INFRA-001
ACCEPTANCE_CRITERIA:
  - PostHog installed but does NOT initialise or fire any events until cookie consent is granted
  - Cookie consent banner component created (non-functional UI only — wiring to PostHog is the criterion here)
  - Consent stored in localStorage key `hudo_cookie_consent`
  - On consent granted: PostHog initialises and begins capturing
  - On consent denied or not yet given: PostHog is completely silent (no network requests)
  - Verified: no PostHog network requests visible in devtools before consent
FILES:
  - lib/posthog.ts
  - components/cookie-consent-banner.tsx
  - .env.example (updated)
NOTES: The consent banner visual design is polished in Sprint 4. For Sprint 0 the requirement is correct behaviour, not visual finish.

---

## Sprint 0 Gate Checklist

- [ ] `pnpm dev` runs locally without errors
- [ ] `pnpm lint` and `pnpm type-check` pass
- [ ] CI passes on an empty PR
- [ ] Vercel preview deploys on PR open
- [ ] All three Supabase environments have the full schema applied
- [ ] `supabase db reset` runs successfully against a clean dev project
- [ ] All RLS tests pass
- [ ] All three R2 buckets are private; unsigned URLs return 403
- [ ] Signing proxy returns a working 15-minute signed URL
- [ ] Sentry receives errors from dev environment
- [ ] PostHog fires no events before cookie consent
- [ ] No secret or credential committed to git
