# Sprint 0 — Infrastructure & Schema

**Status: In Progress**

**Gate:** Local dev runs end-to-end. Schema applied to dev, staging, and prod. Vercel preview deploys on PR. CI passes on an empty commit. All RLS tests pass. All 25 tasks complete.

---

## Tasks

### INFRA (12 tasks: 12 done, 0 not started)

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

- [x] **S0-INFRA-004** — Create Supabase projects

TASK_ID: S0-INFRA-004
TITLE: Create Supabase projects
BRANCH: feat/s0-infra-004-supabase
MODEL: haiku-4.5
STATUS: done
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

- [x] **S0-INFRA-005** — Configure Cloudflare R2

TASK_ID: S0-INFRA-005
TITLE: Configure Cloudflare R2
BRANCH: feat/s0-infra-005-r2
MODEL: haiku-4.5
STATUS: done
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

- [x] **S0-INFRA-008** — Create storage abstraction module

TASK_ID: S0-INFRA-008
TITLE: Create storage abstraction module
BRANCH: feat/s0-infra-008-storage
MODEL: opus-4.6
STATUS: done
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

- [x] **S0-INFRA-011** — Provision Upstash Redis

TASK_ID: S0-INFRA-011
TITLE: Provision Upstash Redis
BRANCH: feat/s0-infra-011-redis
MODEL: haiku-4.5
STATUS: done
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

- [x] **S0-INFRA-012** — Configure Resend

TASK_ID: S0-INFRA-012
TITLE: Configure Resend
BRANCH: feat/s0-infra-012-resend
MODEL: haiku-4.5
STATUS: done
BLOCKED_BY: S0-INFRA-001
ACCEPTANCE_CRITERIA:
  - Resend account created and API keys generated
  - RESEND_API_KEY stored in all three Vercel environment groups
  - Sending domain verified in Resend (or dev domain whitelisted)
  - Test email delivered successfully from dev environment
FILES:
  - .env.example (updated)
NOTES: Required before any auth email flows (confirmation, invitation, password reset) can work.

---

### DB (4 tasks: 4 done, 0 not started)

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

- [x] **S0-DB-002** — Write RLS policies for multi-tenant isolation

TASK_ID: S0-DB-002
TITLE: Write RLS policies for multi-tenant isolation
BRANCH: feat/s0-db-002-rls
MODEL: opus-4.6
STATUS: done
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

- [x] **S0-DB-003** — Write RLS policy test suite

TASK_ID: S0-DB-003
TITLE: Write RLS policy test suite
BRANCH: feat/s0-db-003-rls-tests
MODEL: opus-4.6
STATUS: done
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

- [x] **S0-DB-004** — Create database indexes

TASK_ID: S0-DB-004
TITLE: Create database indexes
BRANCH: feat/s0-db-004-indexes
MODEL: haiku-4.5
STATUS: done
BLOCKED_BY: S0-DB-001
ACCEPTANCE_CRITERIA:
  - All indexes from PRD Section 4.3 are created and tested
  - Query performance verified on local dev
  - No redundant or unused indexes added
FILES:
  - supabase/migrations/0003_indexes.sql (or included in 0001)
NOTES: Indexes should be created after schema is stable.

---

### AUTH (7 tasks: 7 done, 0 not started)

---

- [x] **S0-AUTH-001** — Implement Supabase Auth

TASK_ID: S0-AUTH-001
TITLE: Implement Supabase Auth
BRANCH: feat/s0-auth-001-auth
MODEL: sonnet-4.6
STATUS: done
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

- [x] **S0-AUTH-002** — Build registration flow

TASK_ID: S0-AUTH-002
TITLE: Build registration flow
BRANCH: feat/s0-auth-002-registration
MODEL: sonnet-4.6
STATUS: done
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

- [x] **S0-AUTH-003** — Build sign-in and sign-out

TASK_ID: S0-AUTH-003
TITLE: Build sign-in and sign-out
BRANCH: feat/s0-auth-003-signin
MODEL: haiku-4.5
STATUS: done
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

- [x] **S0-AUTH-004** — Implement brute force protection on auth endpoints

TASK_ID: S0-AUTH-004
TITLE: Implement brute force protection on auth endpoints
BRANCH: feat/s0-auth-004-rate-limit
MODEL: haiku-4.5
STATUS: done
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

- [x] **S0-AUTH-005** — Build invitation flow

TASK_ID: S0-AUTH-005
TITLE: Build invitation flow
BRANCH: feat/s0-auth-005-invitations
MODEL: opus-4.6
STATUS: done
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

- [x] **S0-AUTH-006** — Implement role-based middleware

TASK_ID: S0-AUTH-006
TITLE: Implement role-based middleware
BRANCH: feat/s0-auth-006-middleware
MODEL: sonnet-4.6
STATUS: done
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

- [x] **S0-AUTH-007** — Build password reset flow

TASK_ID: S0-AUTH-007
TITLE: Build password reset flow
BRANCH: feat/s0-auth-007-password-reset
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: S0-AUTH-001, S0-INFRA-012
ACCEPTANCE_CRITERIA:
  - Password reset request page accepts email and sends reset link via Resend
  - Reset link contains a secure, time-limited token (handled by Supabase Auth)
  - Password update page validates new password and confirms change
  - Rate limited at 5 requests per IP per hour via Upstash Redis
  - Expired or invalid tokens show a clear error message
FILES:
  - app/auth/forgot-password/page.tsx
  - app/auth/reset-password/page.tsx
  - app/api/auth/reset-password/route.ts
NOTES: Password reset is required for a complete auth flow before launch.

---

### STORAGE (2 tasks: 2 done, 0 not started)

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

- [x] **S0-STORAGE-002** — Build R2 signing proxy (playback URL generation)

TASK_ID: S0-STORAGE-002
TITLE: Build R2 signing proxy (playback URL generation)
BRANCH: feat/s0-storage-002-signing-proxy
MODEL: sonnet-4.6
STATUS: done
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

### CODE-REVIEW (39 tasks: 0 done, 39 not started)

**Summary:** 9 P1 critical + 12 P2 important + 18 P3 nice-to-have. All P1 issues must be fixed before S0 gate. See `tasks/code-review-2.md` for detailed findings.

---

#### P1 — Critical (Must Fix Before S0 Gate)

---

- [ ] **S0-CODEREVIEW-P1-001** — Fix Next.js 14.2.5 Authorization Bypass CVE

TASK_ID: S0-CODEREVIEW-P1-001
TITLE: Fix Next.js 14.2.5 Authorization Bypass CVE
BRANCH: chore/s0-code-review-p1-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Next.js upgraded from 14.2.5 to >=14.2.25 or ^15.0.0
  - pnpm install completes without errors
  - build succeeds (pnpm run build)
  - Middleware RBAC routes still protected (/admin, /agent, /talent)
  - Verified: no auth bypass possible in upgraded version
FILES:
  - package.json
NOTES: CVE-2025-29927 affects >=14.0.0 <14.2.25. Attackers can circumvent auth middleware. CRITICAL security issue.

---

- [ ] **S0-CODEREVIEW-P1-002** — Consent-gate Sentry initialization

TASK_ID: S0-CODEREVIEW-P1-002
TITLE: Consent-gate Sentry initialization (GDPR/PECR compliance)
BRANCH: chore/s0-code-review-p1-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - instrumentation-client.ts does not call Sentry.init() until cookie consent verified
  - app/global-error.tsx only calls Sentry.captureException() if hasConsent() returns true
  - No Sentry network requests visible in devtools before consent granted
  - Sentry captures errors after consent is granted
FILES:
  - instrumentation-client.ts
  - app/global-error.tsx
  - lib/posthog.ts (reference hasConsent helper)
NOTES: GDPR/UK-PECR violation: Sentry was capturing data and making network calls before consent. Same consent gate as PostHog.

---

- [ ] **S0-CODEREVIEW-P1-003** — Add rate limiting to invitation endpoints

TASK_ID: S0-CODEREVIEW-P1-003
TITLE: Add rate limiting to invitation endpoints (send, validate, accept)
BRANCH: chore/s0-code-review-p1-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - /api/invitations/send rate limited (5/hour per authenticated user)
  - /api/invitations/validate rate limited (10/hour per IP, unauthenticated)
  - /api/invitations/accept rate limited (10/hour per IP, unauthenticated)
  - All return 429 + Retry-After header when limit exceeded
  - Prevents token brute force, invitation spam, and user enumeration
  - Tests verify rate limiting behavior
FILES:
  - app/api/invitations/send/route.ts
  - app/api/invitations/validate/route.ts
  - app/api/invitations/accept/route.ts
  - lib/rate-limit.ts
NOTES: Unauthenticated endpoints use IP-based keys; authenticated use user+endpoint keys. Prevents brute force and enumeration attacks.

---

- [ ] **S0-CODEREVIEW-P1-004** — Fix rate limiting algorithm (fixed window bug)

TASK_ID: S0-CODEREVIEW-P1-004
TITLE: Fix rate limiting algorithm (fixed window TTL reset bug)
BRANCH: chore/s0-code-review-p1-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - lib/redis.ts only calls EXPIRE on first INCR (when count == 1), not on every request
  - Rate limit window does not reset on each request (no TTL creep)
  - Burst attack no longer possible (5 requests at end of window + 5 at start = blocked)
  - Unit tests verify: counter resets after window expires
  - Retroactive fix: existing rate-limit tests still pass
FILES:
  - lib/redis.ts
  - lib/rate-limit.test.ts
NOTES: Current bug: EXPIRE called on every request resets TTL, defeating rate limiting for sustained traffic. Fixed window algorithm now correct.

---

- [ ] **S0-CODEREVIEW-P1-005** — Fix video playback column name mismatch

TASK_ID: S0-CODEREVIEW-P1-005
TITLE: Fix video playback column name mismatch (r2_key vs r2_object_key)
BRANCH: chore/s0-code-review-p1-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Schema migration 0001 defines column as r2_key
  - app/api/videos/[videoId]/playback-url/route.ts selects 'r2_key' (not 'r2_object_key')
  - Signed URL generation receives correct r2_key value
  - Video playback works end-to-end (manual test in staging)
FILES:
  - app/api/videos/[videoId]/playback-url/route.ts
  - supabase/migrations/0001_initial_schema.sql (verify column name)
NOTES: Route queried wrong column name; version.r2_object_key was undefined, breaking video playback entirely.

---

- [ ] **S0-CODEREVIEW-P1-006** — Fix comments RLS policy to filter soft-deleted

TASK_ID: S0-CODEREVIEW-P1-006
TITLE: Fix comments RLS policy to filter soft-deleted comments
BRANCH: chore/s0-code-review-p1-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - comments_select policy adds AND deleted_at IS NULL filter
  - Soft-deleted comments no longer visible via Supabase RLS
  - Existing RLS test for comments updated to verify soft-delete filtering
FILES:
  - supabase/migrations/0002_rls_policies.sql
  - tests/rls/comments.test.sql
NOTES: Architecture requires soft-delete only (no hard delete). RLS must enforce this at query time.

---

- [ ] **S0-CODEREVIEW-P1-007** — Fix middleware redirect path mismatch

TASK_ID: S0-CODEREVIEW-P1-007
TITLE: Fix middleware sign-in redirect path mismatch
BRANCH: chore/s0-code-review-p1-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Middleware redirects to /auth/signin (not /sign-in)
  - PUBLIC_PATHS includes /auth/signin and /auth/register (not /sign-in, /sign-up)
  - Unauthenticated users successfully see sign-in form (not 404)
  - E2E tests updated to navigate to correct URLs
FILES:
  - app/middleware.ts
  - tests/e2e/auth.spec.ts
  - tests/e2e/signin.spec.ts
  - tests/e2e/register.spec.ts
NOTES: Actual routes are /auth/signin and /auth/register. Middleware was redirecting to non-existent /sign-in, causing 404.

---

- [ ] **S0-CODEREVIEW-P1-008** — Fix invitation accept TOCTOU race condition

TASK_ID: S0-CODEREVIEW-P1-008
TITLE: Fix invitation accept TOCTOU race condition
BRANCH: chore/s0-code-review-p1-fixes
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Invitation accept logic is atomic (either fully succeeds or fully fails)
  - Two concurrent requests cannot both accept the same invitation
  - UNIQUE constraint on memberships prevents duplicate entries
  - Accepted_at is only updated if membership insert succeeds
  - Manual test: concurrent acceptance attempts return one 200 + one 409/410
FILES:
  - app/api/invitations/accept/route.ts
  - supabase/migrations/0001_initial_schema.sql (RPC or constraints)
NOTES: Race window exists between membership insert and accepted_at update. Use Postgres transaction or reorder operations to close window.

---

- [ ] **S0-CODEREVIEW-P1-009** — Add missing RLS test files (6 tables)

TASK_ID: S0-CODEREVIEW-P1-009
TITLE: Add missing RLS test files for critical tables
BRANCH: chore/s0-code-review-p1-fixes
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - tests/rls/memberships.test.sql created (tests SECURITY DEFINER fix from migration 0003)
  - tests/rls/invitations.test.sql created (agents cannot read foreign-agency invites)
  - tests/rls/guest_links.test.sql created (talent cannot read/insert links)
  - tests/rls/video_versions.test.sql created (talent sees only own videos)
  - tests/rls/notifications.test.sql created (users cannot read others' notifications)
  - tests/rls/notification_preferences.test.sql created (permission isolation)
  - All tests pass: supabase test db tests/rls
FILES:
  - tests/rls/memberships.test.sql
  - tests/rls/invitations.test.sql
  - tests/rls/guest_links.test.sql
  - tests/rls/video_versions.test.sql
  - tests/rls/notifications.test.sql
  - tests/rls/notification_preferences.test.sql
NOTES: 6 of 11 core tables have zero RLS coverage. Any policy regression goes undetected. CI gate insufficient without these tests.

---

#### P2 — Important (Address in S1 or Before S0 Gate)

---

- [ ] **S0-CODEREVIEW-P2-001** — Fix rate limit consistency & error handling

TASK_ID: S0-CODEREVIEW-P2-001
TITLE: Fix rate limit consistency & error handling gaps
BRANCH: chore/s0-code-review-p2-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - reset-password rate limit call wrapped in try/catch (consistent with signin/register)
  - Rate limit key naming consistent across endpoints (auth:{endpoint}:ip:{ip} pattern)
  - register rate limit checked after validation (not on invalid form data)
  - Retry-After header returns seconds remaining in window (not full window)
FILES:
  - app/api/auth/reset-password/route.ts
  - app/api/auth/register/route.ts
  - lib/rate-limit.ts
NOTES: Inconsistencies in error handling, key naming, and timing make debugging harder. standardize across all endpoints.

---

- [ ] **S0-CODEREVIEW-P2-002** — Lower Sentry & PostHog trace sampling

TASK_ID: S0-CODEREVIEW-P2-002
TITLE: Lower Sentry & PostHog trace sampling rate
BRANCH: chore/s0-code-review-p2-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - instrumentation.ts tracesSampleRate changed to 0.1 (10%) or environment-driven
  - instrumentation-client.ts tracesSampleRate changed to 0.1 (10%) or environment-driven
  - Environment variable SENTRY_TRACES_SAMPLE_RATE documented in .env.example
FILES:
  - instrumentation.ts
  - instrumentation-client.ts
  - .env.example
NOTES: 100% sampling in production excessive; creates quota consumption + latency. 10% still gives good insights.

---

- [ ] **S0-CODEREVIEW-P2-003** — Complete CSP headers

TASK_ID: S0-CODEREVIEW-P2-003
TITLE: Complete CSP headers configuration
BRANCH: chore/s0-code-review-p2-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Remove 'unsafe-inline' from script-src (replace with nonce if inline scripts needed)
  - Add https://js.stripe.com to script-src (S1 Stripe payment integration)
  - Add R2 bucket domain to connect-src and media-src (video playback)
  - Verify CSP headers in Vercel preview: curl -I https://preview-url
FILES:
  - next.config.js
NOTES: Incomplete CSP allows XSS, blocks Stripe, breaks video playback. S3 launch hardening defers 'unsafe-inline' removal.

---

- [ ] **S0-CODEREVIEW-P2-004** — Document invitations RLS UPDATE/DELETE policy

TASK_ID: S0-CODEREVIEW-P2-004
TITLE: Document (or implement) invitations RLS UPDATE/DELETE policy
BRANCH: chore/s0-code-review-p2-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - If acceptance flow runs as service role, document this assumption in migration
  - If acceptance flow ever runs as authenticated user, add UPDATE and DELETE policies to invitations table
  - Verify: no RLS policy errors when invitations route runs
FILES:
  - supabase/migrations/0002_rls_policies.sql (comment added explaining assumption)
  - app/api/invitations/accept/route.ts (verify service role usage)
NOTES: Currently no UPDATE/DELETE policies on invitations; assumption is that API route uses service role. Clarify for future maintenance.

---

- [ ] **S0-CODEREVIEW-P2-005** — Run E2E tests on PRs (not just main)

TASK_ID: S0-CODEREVIEW-P2-005
TITLE: Run E2E tests on PRs, not just main branch
BRANCH: chore/s0-code-review-p2-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - .github/workflows/playwright.yml adds pull_request trigger for main branch
  - E2E tests run on every PR before merge
  - Regressions caught before landing in main
FILES:
  - .github/workflows/playwright.yml
NOTES: Currently E2E only runs after merge to main; too late. Move to PR workflow to catch issues earlier.

---

- [ ] **S0-CODEREVIEW-P2-006** — Fix password reset error message leakage

TASK_ID: S0-CODEREVIEW-P2-006
TITLE: Fix password reset error message leakage
BRANCH: chore/s0-code-review-p2-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - reset-password form no longer reflects Supabase error_description URL param verbatim
  - User sees generic "Invalid or expired link" message instead of "otp_expired"
  - Supabase error details logged server-side only
FILES:
  - app/auth/reset-password/reset-password-form.tsx
NOTES: Supabase error_description in URL query param exposes internal errors like "otp_expired". Generic message better for UX and security.

---

- [ ] **S0-CODEREVIEW-P2-007** — Implement auth fixture & role-based E2E tests

TASK_ID: S0-CODEREVIEW-P2-007
TITLE: Implement authenticated fixture & role-based E2E tests
BRANCH: chore/s0-code-review-p2-fixes
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - tests/e2e/fixtures/auth.ts fully implemented (not shell)
  - Authenticated page fixture reusable across tests
  - E2E tests use fixture instead of manual .fill() / .press()
  - Middleware role tests added (marked as S1-E2E-001 deferred; placeholder here)
FILES:
  - tests/e2e/fixtures/auth.ts
  - tests/e2e/middleware-roles.spec.ts
  - tests/e2e/auth.spec.ts (refactored to use fixture)
NOTES: Current tests manually handle auth; difficult to maintain. Fixture pattern reduces duplication and improves readability.

---

- [ ] **S0-CODEREVIEW-P2-008** — Verify video column consistency

TASK_ID: S0-CODEREVIEW-P2-008
TITLE: Verify video column name consistency across codebase
BRANCH: chore/s0-code-review-p2-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Search all .ts and .sql files for r2_key and r2_object_key references
  - All references use r2_key (matches schema definition)
  - No stray r2_object_key references remain in code
FILES:
  - supabase/migrations/0001_initial_schema.sql
  - app/api/videos/[videoId]/playback-url/route.ts
  - lib/storage.ts
  - Any other files referencing video storage columns
NOTES: Fix in P1.5 resolves immediate issue; this ensures no other stray references exist.

---

- [ ] **S0-CODEREVIEW-P2-009** — Refactor RLS policies to use SECURITY DEFINER uniformly

TASK_ID: S0-CODEREVIEW-P2-009
TITLE: Refactor RLS policies to use SECURITY DEFINER uniformly
BRANCH: chore/s0-code-review-p2-fixes
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - All RLS policies use SECURITY DEFINER functions instead of raw subqueries
  - Eliminates recursion fragility (migration 0003 only fixes memberships)
  - All existing RLS tests pass with refactored policies
  - Deferred to S3 hardening (not critical for S1)
FILES:
  - supabase/migrations/0002_rls_policies.sql (refactor over time)
NOTES: Current design: memberships_select uses SECURITY DEFINER, others use subqueries. Unify for consistency and reduced recursion risk.

---

- [ ] **S0-CODEREVIEW-P2-010** — Add RPC caller validation for create_video_version

TASK_ID: S0-CODEREVIEW-P2-010
TITLE: Add RPC caller validation to create_video_version
BRANCH: chore/s0-code-review-p2-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - create_video_version RPC validates p_uploaded_by == auth.uid()
  - Prevents users from creating versions attributed to others
  - Test: RPC rejects mismatched uid with clear error message
FILES:
  - supabase/migrations/0001_initial_schema.sql (RPC definition)
  - tests/rls/ (add test case)
NOTES: RPC currently accepts caller-supplied uploaded_by without validation. Add check: IF p_uploaded_by != auth.uid() THEN RAISE.

---

- [ ] **S0-CODEREVIEW-P2-011** — Add env var guard to reset-password rate limit

TASK_ID: S0-CODEREVIEW-P2-011
TITLE: Add env var guard to reset-password rate limit call
BRANCH: chore/s0-code-review-p2-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - reset-password rate limit wrapped in try/catch (like signin/register)
  - If UPSTASH_REDIS_REST_URL missing, fails open with informative error
  - Does not 500 endpoint if Redis unavailable
FILES:
  - app/api/auth/reset-password/route.ts
NOTES: Inconsistent error handling: signin/register have try/catch, reset-password does not. Unify approach.

---

- [ ] **S0-CODEREVIEW-P2-012** — Remove E2E test credential fallback

TASK_ID: S0-CODEREVIEW-P2-012
TITLE: Remove hardcoded E2E test credential fallback
BRANCH: chore/s0-code-review-p2-fixes
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - tests/e2e/signin.spec.ts removes fallback password (const TEST_AGENCY_PASSWORD defaults to known value)
  - Throws clear error if E2E_TEST_AGENCY_PASSWORD env var not set
  - CI/CD docs updated to require E2E_TEST_AGENCY_PASSWORD
FILES:
  - tests/e2e/signin.spec.ts
  - .github/workflows/playwright.yml (verify env var set)
NOTES: Known password 'TestPass1' in source control is a security risk. Force env var configuration.

---

#### P3 — Nice to Have

---

- [ ] **S0-CODEREVIEW-P3-001** — Optimize Retry-After header calculation

TASK_ID: S0-CODEREVIEW-P3-001
TITLE: Optimize Retry-After header to return window remaining
BRANCH: chore/s0-code-review-p3-improvements
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Retry-After returns seconds remaining in current window, not full window
  - User making request at 30s into 60s window gets Retry-After: 30 (not 60)
FILES:
  - lib/rate-limit.ts
NOTES: P3 quality improvement; after P1.4 fix, Retry-After can be more accurate.

---

- [ ] **S0-CODEREVIEW-P3-002** — Use Redis singleton in playback-url route

TASK_ID: S0-CODEREVIEW-P3-002
TITLE: Use Redis singleton in playback-url route
BRANCH: chore/s0-code-review-p3-improvements
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Redis client created once at module level, not per-request
  - Reduces connection overhead in videos/playback endpoint
FILES:
  - app/api/videos/[videoId]/playback-url/route.ts
  - lib/redis.ts (export singleton)
NOTES: Minor performance optimization; currently creates Redis client fresh on every request.

---

- [ ] **S0-CODEREVIEW-P3-003** — Add Firefox and WebKit to E2E tests

TASK_ID: S0-CODEREVIEW-P3-003
TITLE: Add Firefox and WebKit browsers to E2E test matrix
BRANCH: chore/s0-code-review-p3-improvements
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - playwright.config.ts enables chromium, firefox, and webkit projects
  - All E2E tests run on 3 browsers (increases CI time)
FILES:
  - playwright.config.ts
NOTES: Deferred to S3 launch hardening; currently Chromium only. Multi-browser testing improves compatibility coverage.

---

- [ ] **S0-CODEREVIEW-P3-004** — Raise Playwright timeout for cold Vercel previews

TASK_ID: S0-CODEREVIEW-P3-004
TITLE: Raise Playwright expect timeout for cold Vercel previews
BRANCH: chore/s0-code-review-p3-improvements
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - playwright.config.ts expect timeout raised from 5s to 10s
  - Reduces flakiness on first deployment after long idle
FILES:
  - playwright.config.ts
NOTES: Cold Vercel previews can be slow on first request; 5s timeout too tight. 10s safer.

---

- [ ] **S0-CODEREVIEW-P3-005** — Add pnpm audit to CI

TASK_ID: S0-CODEREVIEW-P3-005
TITLE: Add pnpm audit step to CI pipeline
BRANCH: chore/s0-code-review-p3-improvements
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - .github/workflows/ci.yml adds pnpm audit step
  - Fails CI if high-severity vulnerabilities found
  - Next.js CVE (P1.1) would have been caught if audit was enabled
FILES:
  - .github/workflows/ci.yml
NOTES: Would catch dependency vulnerabilities like Next.js CVE automatically. Simple addition, high value.

---

- [ ] **S0-CODEREVIEW-P3-006** — Extract shared hash computation helper

TASK_ID: S0-CODEREVIEW-P3-006
TITLE: Extract shared hash computation helper for invitations
BRANCH: chore/s0-code-review-p3-improvements
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - lib/invitations.ts created with shared hash utility
  - send/route.ts and validate/route.ts both use helper
  - Reduces code duplication, improves maintainability
FILES:
  - lib/invitations.ts (new)
  - app/api/invitations/send/route.ts (refactored)
  - app/api/invitations/validate/route.ts (refactored)
NOTES: Hash computation duplicated in send (line 123) and validate (line 27). Extract helper.

---

- [ ] **S0-CODEREVIEW-P3-007** — Remove plaintext token logging on email failure

TASK_ID: S0-CODEREVIEW-P3-007
TITLE: Remove plaintext token logging on email failure
BRANCH: chore/s0-code-review-p3-improvements
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - invitations/send/route.ts removes console.log(plaintext token) on Resend error
  - Uses hashed token or generic message in logs instead
  - Prevents token exposure in Vercel/Sentry logs
FILES:
  - app/api/invitations/send/route.ts (line ~164)
NOTES: Plaintext token logged when Resend email fails; exposes sensitive data in observability systems.

---

- [ ] **S0-CODEREVIEW-P3-008** — Simplify video active_version_id NULL handling

TASK_ID: S0-CODEREVIEW-P3-008
TITLE: Simplify video active_version_id NULL handling with default
BRANCH: chore/s0-code-review-p3-improvements
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - videos.active_version_id has a sensible default (or is NOT NULL with constraint)
  - Reduces NULL checks in JOINs for newly uploaded videos
  - Player page handles both populated and NULL active_version_id correctly
FILES:
  - supabase/migrations/0001_initial_schema.sql (add default or constraint)
  - app/api/videos/[videoId]/playback-url/route.ts (verify no NULL assumptions)
NOTES: Column currently nullable with no default; new videos require active_version_id to be set before playback works.

---

- [ ] **S0-CODEREVIEW-P3-009** — Communicate signed URL expiry to client

TASK_ID: S0-CODEREVIEW-P3-009
TITLE: Communicate signed URL expiry time to client
BRANCH: chore/s0-code-review-p3-improvements
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - playback-url endpoint returns expiry timestamp in response
  - Client can proactively refresh URL when approaching expiry
  - Prevents stale URL errors mid-playback
FILES:
  - app/api/videos/[videoId]/playback-url/route.ts (response body)
  - lib/storage.ts (return expiry info from signing function)
NOTES: S1 feature: player page can use expiry to refresh URL before it expires (15min window).

---

- [ ] **S0-CODEREVIEW-P3-010** — Add generateUploadUrl stub to StorageClient

TASK_ID: S0-CODEREVIEW-P3-010
TITLE: Add generateUploadUrl stub to StorageClient interface
BRANCH: chore/s0-code-review-p3-improvements
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - lib/storage.ts StorageClient interface includes generateUploadUrl method (stub)
  - S1 video upload feature (S1-UPLOAD-001) implements method
  - Current stub returns NotImplementedError or placeholder
FILES:
  - lib/storage.ts
NOTES: S1 video upload needs presigned PUT URLs from R2. Add interface now to avoid S1 refactoring.

---

- [ ] **S0-CODEREVIEW-P3-011** — Improve E2E POM page object methods

TASK_ID: S0-CODEREVIEW-P3-011
TITLE: Improve E2E page object model with populated methods
BRANCH: chore/s0-code-review-p3-improvements
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - tests/e2e/pages/*.ts files have implemented selector methods (not empty)
  - Selectors match actual DOM elements (data-testid or semantic selectors)
  - Tests use POM methods instead of inline selectors
FILES:
  - tests/e2e/pages/AuthPage.ts
  - tests/e2e/pages/DashboardPage.ts
  - tests/e2e/pages/GuestPage.ts
  - tests/e2e/pages/PlayerPage.ts
  - tests/e2e/pages/UploadPage.ts
NOTES: POM stubs empty; selectors only documented in comments. Populate methods for S1 test expansion.

---

- [ ] **S0-CODEREVIEW-P3-012** — Add E2E test auto-cleanup for created users

TASK_ID: S0-CODEREVIEW-P3-012
TITLE: Add E2E test cleanup for created users
BRANCH: chore/s0-code-review-p3-improvements
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - E2E tests clean up created users after each run
  - Database does not accumulate orphaned test users
  - Tests use fixture teardown or afterEach hook
FILES:
  - tests/e2e/fixtures/auth.ts
  - tests/e2e/auth.spec.ts
  - playwright.config.ts (if needed for global teardown)
NOTES: Currently test users accumulate in staging DB. Add cleanup to keep DB tidy across test runs.

---

- [ ] **S0-CODEREVIEW-P3-013** — Fix storage singleton test cross-contamination

TASK_ID: S0-CODEREVIEW-P3-013
TITLE: Fix storage singleton test cross-contamination from env mutation
BRANCH: chore/s0-code-review-p3-improvements
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - lib/storage.ts singleton is reset between test runs
  - Env var mutations in one test do not affect others
  - Test isolation verified with storage env change test
FILES:
  - lib/storage.ts
  - lib/storage.test.ts (add isolation test)
NOTES: Storage instance created per env vars; mutations in one test could affect subsequent tests if not reset.

---

- [ ] **S0-CODEREVIEW-P3-014** — Add soft-delete coverage to comments RLS tests

TASK_ID: S0-CODEREVIEW-P3-014
TITLE: Add soft-delete coverage to comments RLS tests
BRANCH: chore/s0-code-review-p3-improvements
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - tests/rls/comments.test.sql includes test for deleted_at filtering
  - Verifies soft-deleted comments are not returned by SELECT
  - Test uses pgTAP throws_ok for error cases
FILES:
  - tests/rls/comments.test.sql
NOTES: Existing soft-delete coverage incomplete. Add explicit test to verify deleted_at IS NULL filtering.

---

- [ ] **S0-CODEREVIEW-P3-015** — Fix consent banner hydration flicker

TASK_ID: S0-CODEREVIEW-P3-015
TITLE: Fix consent banner hydration flicker on page load
BRANCH: chore/s0-code-review-p3-improvements
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Consent banner does not flash in/out on page load (hydration mismatch fixed)
  - Banner rendered server-side or in suppressHydrationWarning
  - PECR/consent rules not violated during brief initial render
FILES:
  - components/cookie-consent-banner.tsx
NOTES: Brief absence of banner during hydration could allow scripts to load before consent checked. Minor risk but fixable.

---

- [ ] **S0-CODEREVIEW-P3-016** — Improve storage test access control assertions

TASK_ID: S0-CODEREVIEW-P3-016
TITLE: Improve storage test access control assertions
BRANCH: chore/s0-code-review-p3-improvements
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - app/api/videos/[videoId]/playback-url/route.test.ts assertions are not tautological
  - Tests verify actual RLS/auth logic, not just route handler calls
  - Consider integration tests vs mocked tests
FILES:
  - app/api/videos/[videoId]/playback-url/route.test.ts
NOTES: Current assertions test route handler; do not verify RLS policy or Supabase auth. Consider refactoring for better coverage.

---

- [ ] **S0-CODEREVIEW-P3-017** — Add frontend URL validation

TASK_ID: S0-CODEREVIEW-P3-017
TITLE: Add frontend URL validation and correction
BRANCH: chore/s0-code-review-p3-improvements
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Register form links to /auth/signin (not /sign-in)
  - All internal links verified to use correct paths
  - Helper function for safe path generation (optional, for S2+)
FILES:
  - app/auth/register/page.tsx
  - app/auth/signin/page.tsx
NOTES: Register links to wrong path. Verify all frontend navigation uses correct URLs.

---

- [ ] **S0-CODEREVIEW-P3-018** — Add security & performance observability

TASK_ID: S0-CODEREVIEW-P3-018
TITLE: Add security & performance observability
BRANCH: chore/s0-code-review-p3-improvements
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Rate limit events sent to Sentry/PostHog for monitoring
  - RLS policy violations logged with context
  - Performance metrics added for storage signing (latency, errors)
  - Dashboards created for observability (optional, for S2+)
FILES:
  - lib/rate-limit.ts
  - app/api/videos/[videoId]/playback-url/route.ts
  - lib/posthog.ts or app/providers.tsx (for event tracking)
NOTES: Currently no visibility into auth/RLS/storage failures. Add observability for S1+ debugging and incident response.

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
- [ ] **All P1 code review issues fixed** (P1.1 through P1.9)
- [ ] **P1 fixes verified:** pnpm format:check && pnpm type-check && pnpm lint passes
- [ ] **P1 fixes verified:** pnpm test passes
- [ ] **P1 fixes verified:** supabase test db tests/rls passes
- [ ] **P1 fixes verified:** E2E tests pass (pnpm test:e2e)
