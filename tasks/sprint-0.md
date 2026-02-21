# Sprint 0 — Infrastructure & Schema

**Status: In Progress**

**Gate:** Local dev runs end-to-end. Schema applied to dev, staging, and prod. Vercel preview deploys on PR. CI passes on an empty commit. All RLS tests pass. All 24 tasks complete.

---

## Tasks

### INFRA (11 tasks: 8 done, 3 not started)

---

- [x] **S0-INFRA-001** — Create GitHub repository

TASK_ID: S0-INFRA-001
TITLE: Create GitHub repository
BRANCH: feat/s0-infra-001-repo-init
MODEL: haiku-4.5
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Repository created on GitHub with correct name
  - README.md describes project and provides setup instructions
  - CONTRIBUTING.md documents the development workflow
  - .gitignore configured for Node.js and environment variables
  - Initial commit includes package.json stub
FILES:
  - README.md
  - CONTRIBUTING.md
  - .gitignore
NOTES: This is the foundation task.

---

- [x] **S0-INFRA-002** — Initialise Next.js project

TASK_ID: S0-INFRA-002
TITLE: Initialise Next.js project
BRANCH: feat/s0-infra-002-nextjs
MODEL: haiku-4.5
STATUS: done
BLOCKED_BY: S0-INFRA-001
ACCEPTANCE_CRITERIA:
  - Next.js 14 project created with App Router and TypeScript strict mode
  - Shadcn UI initialised (all default components available)
  - Tailwind CSS configured
  - ESLint and Prettier configured with rules enforced in CI
  - `.env.example` lists all required environment variables with descriptions, no values
  - Project runs locally with `pnpm dev` and renders default page
FILES:
  - package.json
  - next.config.js
  - tsconfig.json
  - tailwind.config.ts
  - .eslintrc.json
  - .prettierrc
  - .env.example
NOTES: Use pnpm as package manager. Node 20 LTS. Do not install any feature dependencies yet.

---

- [x] **S0-INFRA-003** — Configure Vercel project

TASK_ID: S0-INFRA-003
TITLE: Configure Vercel project
BRANCH: feat/s0-infra-003-vercel
MODEL: haiku-4.5
STATUS: done
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
NOTES: Do not store any secrets in the repo.

---

- [ ] **S0-INFRA-004** — Create Supabase projects

TASK_ID: S0-INFRA-004
TITLE: Create Supabase projects
BRANCH: feat/s0-infra-004-supabase
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: S0-INFRA-001
ACCEPTANCE_CRITERIA:
  - Three Supabase projects created: hudo-dev, hudo-staging, hudo-prod
  - Each project has its connection string, anon key, and service role key stored in the correct Vercel environment group
  - RLS is enabled at the project level for all three environments
  - Each project has email auth enabled; social providers disabled
FILES:
  - .env.example (updated with Supabase variable names)
NOTES: Service role key must never appear in client-side code or be committed to git.

---

- [ ] **S0-INFRA-005** — Configure Cloudflare R2

TASK_ID: S0-INFRA-005
TITLE: Configure Cloudflare R2
BRANCH: feat/s0-infra-005-r2
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: S0-INFRA-001
ACCEPTANCE_CRITERIA:
  - Three R2 buckets created: hudo-dev, hudo-staging, hudo-prod (separate from S0-STORAGE-001)
  - Buckets are private with no public policy
  - R2 API credentials stored in Vercel environment groups
FILES:
  - .env.example (updated)
NOTES: This is infrastructure setup; actual bucket configuration happens in S0-STORAGE-001.

---

- [x] **S0-INFRA-006** — Set up GitHub Actions CI pipeline

TASK_ID: S0-INFRA-006
TITLE: Set up GitHub Actions CI pipeline
BRANCH: feat/s0-infra-006-ci
MODEL: haiku-4.5
STATUS: done
BLOCKED_BY: S0-INFRA-001
ACCEPTANCE_CRITERIA:
  - CI runs on every PR and push to main
  - Steps: install dependencies, lint, type-check, run tests
  - CI passes on an empty test suite
  - Branch protection rule on main documented in README
FILES:
  - .github/workflows/ci.yml
  - .github/workflows/pr-review.yml
  - .github/pr-review-prompt.md
NOTES: Use pnpm in CI. PR review uses DeepSeek V3. Requires DEEPSEEK_API_KEY secret in GitHub.

---

- [x] **S0-INFRA-007** — Configure secure HTTP headers

TASK_ID: S0-INFRA-007
TITLE: Configure secure HTTP headers
BRANCH: feat/s0-infra-007-headers
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - All five required headers present on every response
  - CSP allows: self, Supabase, Stripe, PostHog, Sentry
  - Headers verified with curl on local dev and Vercel preview
  - Session cookies configured: SameSite=Lax; Secure; HttpOnly
FILES:
  - next.config.js
NOTES: CSP must not block Supabase Realtime websocket (wss://). Test with browser devtools.

---

- [ ] **S0-INFRA-008** — Create storage abstraction module

TASK_ID: S0-INFRA-008
TITLE: Create storage abstraction module
BRANCH: feat/s0-infra-008-storage
MODEL: opus-4.6
STATUS: not_started
BLOCKED_BY: S0-INFRA-005
ACCEPTANCE_CRITERIA:
  - lib/storage.ts exports a single interface for all R2 operations
  - Supports: put, get, delete, generateSignedUrl
  - All operations use service role credentials from environment
  - No R2 URLs ever returned directly to client
FILES:
  - lib/storage.ts
NOTES: This abstraction is used by S0-STORAGE-002 and S1-UPLOAD-001.

---

- [x] **S0-INFRA-009** — Configure Sentry

TASK_ID: S0-INFRA-009
TITLE: Configure Sentry
BRANCH: feat/s0-infra-009-sentry
MODEL: haiku-4.5
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Sentry Next.js SDK installed and configured
  - Separate Sentry projects or DSNs for dev/staging/prod
  - Errors captured in both client and server components
  - Source maps uploaded on production build
  - A deliberate thrown error in a test route confirms Sentry receives it
FILES:
  - sentry.client.config.ts
  - sentry.server.config.ts
  - sentry.edge.config.ts
  - next.config.js (updated)
  - .env.example (updated)
NOTES: Do not enable session replay in MVP — GDPR implications.

---

- [x] **S0-INFRA-010** — Configure PostHog

TASK_ID: S0-INFRA-010
TITLE: Configure PostHog
BRANCH: feat/s0-infra-010-posthog
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - PostHog installed but does NOT initialise until cookie consent granted
  - Cookie consent banner component created
  - Consent stored in localStorage key `hudo_cookie_consent`
  - On consent granted: PostHog initialises and begins capturing
  - No PostHog network requests visible in devtools before consent
FILES:
  - lib/posthog.ts
  - components/cookie-consent-banner.tsx
  - .env.example (updated)
NOTES: Consent banner visual design is polished in Sprint 4. MVP requires correct behaviour only.

---

- [ ] **S0-INFRA-011** — Provision Upstash Redis

TASK_ID: S0-INFRA-011
TITLE: Provision Upstash Redis
BRANCH: feat/s0-infra-011-redis
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: S0-INFRA-003
ACCEPTANCE_CRITERIA:
  - Upstash Redis database created
  - Rest API token and URL stored in Vercel environment groups for all three environments
  - lib/redis.ts exports client for rate limiting only
  - Connection verified with a test operation
FILES:
  - lib/redis.ts
  - .env.example (updated)
NOTES: Redis is used for rate limiting only, not for caching or sessions in Sprint 0.

---

### DB (4 tasks: 1 done, 3 not started)

---

- [x] **S0-DB-001** — Write base database migration

TASK_ID: S0-DB-001
TITLE: Write base database migration
BRANCH: feat/s0-db-001-schema
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Migration file covers all 11 tables from PRD and Build Foundation
  - All indexes from PRD Section 4.3 are created
  - RLS is enabled on all tables
  - Migration applied successfully to hudo-dev, hudo-staging, and hudo-prod
  - `supabase db reset` succeeds against a clean project
  - No table, column, or policy is missing relative to spec
FILES:
  - supabase/migrations/0001_initial_schema.sql
NOTES: Copy SQL from Build Foundation exactly. Migration must be idempotent.

---

- [ ] **S0-DB-002** — Write RLS policies for multi-tenant isolation

TASK_ID: S0-DB-002
TITLE: Write RLS policies for multi-tenant isolation
BRANCH: feat/s0-db-002-rls
MODEL: opus-4.6
STATUS: not_started
BLOCKED_BY: S0-DB-001
ACCEPTANCE_CRITERIA:
  - RLS policies enforce: cross-agency data access is impossible
  - Talent cannot read other talent's videos
  - Guests have no Supabase access
  - Audit log cannot be updated or deleted via client
  - All policies from Build Foundation Part 2 are applied
  - All policies tested and verified in development
FILES:
  - supabase/migrations/0002_rls_policies.sql
NOTES: RLS must be bulletproof — this is the primary isolation mechanism for multi-tenancy.

---

- [ ] **S0-DB-003** — Write RLS policy test suite

TASK_ID: S0-DB-003
TITLE: Write RLS policy test suite
BRANCH: feat/s0-db-003-rls-tests
MODEL: opus-4.6
STATUS: not_started
BLOCKED_BY: S0-DB-002
ACCEPTANCE_CRITERIA:
  - Test suite in `tests/rls/` using pgTAP or equivalent
  - Tests cover cross-agency isolation, talent isolation, guest access, audit log immutability
  - Tests run in CI via GitHub Actions
  - All tests pass against current schema
  - Each test includes a comment explaining which PRD policy it enforces
FILES:
  - tests/rls/agencies.test.sql
  - tests/rls/videos.test.sql
  - tests/rls/comments.test.sql
  - tests/rls/audit_log.test.sql
  - .github/workflows/ci.yml (updated)
NOTES: Any future deletion of an RLS policy must cause at least one test to fail.

---

- [ ] **S0-DB-004** — Create database indexes

TASK_ID: S0-DB-004
TITLE: Create database indexes
BRANCH: feat/s0-db-004-indexes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: S0-DB-001
ACCEPTANCE_CRITERIA:
  - All indexes from PRD Section 4.3 are created and tested
  - Query performance verified on local dev
  - No redundant or unused indexes added
FILES:
  - supabase/migrations/0003_indexes.sql (or included in 0001)
NOTES: Indexes should be created after schema is stable.

---

### AUTH (6 tasks: 0 done, 6 not started)

---

- [ ] **S0-AUTH-001** — Implement Supabase Auth

TASK_ID: S0-AUTH-001
TITLE: Implement Supabase Auth
BRANCH: feat/s0-auth-001-auth
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Supabase Auth client initialized in app
  - Session management configured and tested
  - Auth state persists across page reloads
  - Unauthenticated users redirected to sign-in page
FILES:
  - lib/auth.ts
  - app/middleware.ts
  - .env.example (updated)
NOTES: This is the foundation for all auth flows.

---

- [ ] **S0-AUTH-002** — Build registration flow

TASK_ID: S0-AUTH-002
TITLE: Build registration flow
BRANCH: feat/s0-auth-002-registration
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: S0-DB-001, S0-AUTH-001
ACCEPTANCE_CRITERIA:
  - Registration page accepts email and password
  - Password validation enforced (minimum requirements per PRD)
  - User record created in `users` table on successful registration
  - Confirmation email sent via Resend
  - User redirected to onboarding flow after confirmation
  - Error handling for duplicate emails and invalid inputs
FILES:
  - app/auth/register/page.tsx
  - app/api/auth/register/route.ts
NOTES: Email confirmation is required before account is active.

---

- [ ] **S0-AUTH-003** — Build sign-in and sign-out

TASK_ID: S0-AUTH-003
TITLE: Build sign-in and sign-out
BRANCH: feat/s0-auth-003-signin
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: S0-AUTH-001
ACCEPTANCE_CRITERIA:
  - Sign-in page with email and password fields
  - Error messages for invalid credentials
  - Sign-out clears session and redirects to sign-in
  - Sign-in sets session cookie with appropriate flags
FILES:
  - app/auth/signin/page.tsx
  - app/api/auth/signin/route.ts
  - app/api/auth/signout/route.ts
NOTES: Session management handled by Supabase Auth.

---

- [ ] **S0-AUTH-004** — Implement brute force protection on auth endpoints

TASK_ID: S0-AUTH-004
TITLE: Implement brute force protection on auth endpoints
BRANCH: feat/s0-auth-004-rate-limit
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: S0-AUTH-001, S0-INFRA-011
ACCEPTANCE_CRITERIA:
  - Rate limiting enforced on sign-in and registration endpoints
  - Redis used to track failed attempts per IP and email
  - Max 5 failed attempts per 15 minutes per identity
  - HTTP 429 response with Retry-After header on rate limit exceeded
  - Legitimate users can still sign in after cooldown period
FILES:
  - lib/rate-limit.ts
  - app/api/auth/signin/route.ts (updated)
  - app/api/auth/register/route.ts (updated)
NOTES: Critical for security. Always return 429 + Retry-After.

---

- [ ] **S0-AUTH-005** — Build invitation flow

TASK_ID: S0-AUTH-005
TITLE: Build invitation flow
BRANCH: feat/s0-auth-005-invitations
MODEL: opus-4.6
STATUS: not_started
BLOCKED_BY: S0-DB-001, S0-AUTH-001
ACCEPTANCE_CRITERIA:
  - Admin can send invitations to email addresses
  - Invitation email contains unique, time-limited link
  - Invitation link sign-in creates user and adds to agency
  - Invitation expires after 7 days
  - Invalid or expired invitations show error
  - User can only be invited once per email per agency
FILES:
  - supabase/migrations/[number]_invitations_table.sql
  - app/api/invitations/send/route.ts
  - app/auth/invite/[token]/page.tsx
NOTES: Invitations are how talent and agents join agencies.

---

- [ ] **S0-AUTH-006** — Implement role-based middleware

TASK_ID: S0-AUTH-006
TITLE: Implement role-based middleware
BRANCH: feat/s0-auth-006-middleware
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: S0-AUTH-003, S0-DB-002
ACCEPTANCE_CRITERIA:
  - Middleware checks user role from `memberships` table
  - Routes protected by role: /agent, /admin
  - Talent dashboard accessible only to talent role users
  - Guest links bypass auth middleware (authenticated separately)
  - Unauthorized access returns 403
FILES:
  - app/middleware.ts (updated)
  - lib/auth.ts (updated)
NOTES: Roles are: owner > admin_agent > agent > talent > guest.

---

### STORAGE (2 tasks: 1 done, 1 not started)

---

- [x] **S0-STORAGE-001** — Configure Cloudflare R2 buckets

TASK_ID: S0-STORAGE-001
TITLE: Configure Cloudflare R2 buckets
BRANCH: feat/s0-storage-001-r2-buckets
MODEL: haiku-4.5
STATUS: done
BLOCKED_BY: S0-INFRA-001
ACCEPTANCE_CRITERIA:
  - Three R2 buckets created: hudo-dev, hudo-staging, hudo-prod
  - All buckets: private, no public bucket policy, no public fallback
  - CORS configured on all buckets: allow PUT uploads from app domain only
  - Object versioning enabled on all buckets
  - R2 API credentials stored in correct Vercel environment groups
  - Verified: direct unsigned R2 URL returns 403
  - Verified: CORS rejects request from non-app domain
FILES:
  - docs/r2-setup.md
  - .env.example (updated)
NOTES: CORS policy allows PUT only; GET through signing proxy. No unauthenticated access.

---

- [ ] **S0-STORAGE-002** — Build R2 signing proxy (playback URL generation)

TASK_ID: S0-STORAGE-002
TITLE: Build R2 signing proxy (playback URL generation)
BRANCH: feat/s0-storage-002-signing-proxy
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: S0-DB-002, S0-STORAGE-001
ACCEPTANCE_CRITERIA:
  - `GET /api/videos/:videoId/playback-url` returns a signed R2 URL with 15-minute expiry
  - Route validates: requesting user is authenticated and has access to the video
  - Direct R2 object URL is never returned to the client — only the signed URL
  - Unauthenticated requests return 401
  - Requests for videos the user cannot access return 403
  - Signed URL expires after 15 minutes (verified with manual test)
FILES:
  - app/api/videos/[videoId]/playback-url/route.ts
  - lib/storage.ts (updated with signing utility)
NOTES: Use AWS SDK v3 `@aws-sdk/client-s3` with `getSignedUrl`. R2 is S3-compatible.

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
