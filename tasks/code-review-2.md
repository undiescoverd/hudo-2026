# Full Codebase Review — Feb 2026

**Scope:** Comprehensive review of all Sprint 0 code across 9 domains (Auth, Invitations, Middleware, Rate Limiting, Storage, Database, Frontend, Infrastructure, E2E Tests).

**Date:** 2026-02-24
**Model:** Sonnet 4.6 (all agents)
**Previous Review:** 2026-02-22 identified 4 P1 security issues in auth — **all verified fixed** below.

---

## Summary

- **9 critical P1 issues found** (mostly new, not caught in previous review)
- **13 important P2 issues** (architectural, consistency, test coverage gaps)
- **18 nice-to-have P3 improvements** (code quality, UX, maintainability)
- **Key finding:** Multiple critical CVEs in Next.js 14.2.5 and pervasive missing rate limiting on invitation endpoints

---

## P1 — Critical (Must Fix Before S0 Gate)

### 1. Next.js 14.2.5 Authorization Bypass CVE
**Files:** `package.json:29`
**Severity:** CRITICAL
**Details:**
Next.js 14.2.5 is affected by:
- **CVE-2025-29927 (Auth Bypass in Middleware)** — affects `>=14.0.0 <14.2.25`. Attackers can circumvent middleware-enforced auth checks, directly bypassing Hudo's RBAC layer (`/admin`, `/agent`, `/talent` guards collapse).
- Additional: DoS, cache poisoning vulnerabilities also present.

**Impact:** Role-based access control entirely breakable by attackers.
**Fix:** Upgrade `next` to `>=14.2.25` or `^15.0.0` immediately.

```bash
pnpm upgrade next@latest
pnpm install
```

---

### 2. Sentry & PostHog Initialization Without Consent Gate
**Files:** `instrumentation-client.ts:1-11`, `app/global-error.tsx:14`
**Severity:** CRITICAL (GDPR/UK-PECR Violation)
**Details:**
- `instrumentation-client.ts` calls `Sentry.init()` on client load before any cookie consent check.
- `app/global-error.tsx` calls `Sentry.captureException()` unconditionally.
- Both cause Sentry to capture errors and make network calls to `*.sentry.io` for all users, regardless of consent status.
- **Architecture Rule Violation:** "PostHog script must not load before cookie consent" — same applies to Sentry.

**Impact:** GDPR/UK-PECR non-compliance; unauthorised data processing.
**Fix (instrumentation-client.ts):**

```ts
// instrumentation-client.ts
import { hasConsent } from '@/lib/posthog'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  beforeSend: (event) => {
    return hasConsent() ? event : null
  },
  // ... rest of config
})
```

**Fix (app/global-error.tsx:14):**

```tsx
'use client'
import { hasConsent } from '@/lib/posthog'

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (hasConsent()) {
      Sentry.captureException(error)
    }
  }, [error])
  // ...
}
```

---

### 3. Missing Rate Limiting on Invitation Endpoints (3 endpoints)
**Files:** `app/api/invitations/accept/route.ts`, `app/api/invitations/send/route.ts`, `app/api/invitations/validate/route.ts`
**Severity:** CRITICAL
**Details:**
- **Accept endpoint:** Unauthenticated, account-creation vector. No rate limiting → attacker can attempt unlimited token validation/acceptance attempts.
- **Send endpoint:** Authenticated but no rate limiting → invitation spam (costs Resend email quota).
- **Validate endpoint:** Unauthenticated, reveals user existence via `userExists` field. No rate limiting → enumeration attack at unlimited speed.
- All three are explicitly listed in CLAUDE.md as required rate-limit targets.

**Impact:** Token brute force, invitation spam, user enumeration.
**Fix:** Apply `checkAuthRateLimit()` (IP-based for unauthenticated endpoints):

```ts
// invitations/accept/route.ts (before token lookup)
import { checkAuthRateLimit } from '@/lib/rate-limit'
const ip = getClientIp(request)
const rateLimitKey = `invitation:accept:ip:${ip}`
const remaining = await checkAuthRateLimit(rateLimitKey, 10, 3600) // 10/hour
if (remaining < 0) {
  return NextResponse.json({ error: 'Too many attempts' }, { status: 429, headers: { 'Retry-After': '3600' } })
}
```

---

### 4. Rate Limiting Algorithm Broken — Fixed Window with Expiry Reset
**Files:** `lib/redis.ts:25-28`
**Severity:** CRITICAL
**Details:**
The current implementation:
```ts
const current = await pipeline.incr(key).expire(key, window)
```
Calls `EXPIRE` on **every request**, not just on first increment. This resets the TTL on each hit, causing the counter to never decay if requests arrive steadily. A user making 5 requests at the end of window + 5 more at the start of next window = 10 requests in rapid succession (burst attack).

**Impact:** Rate limiting ineffective against bursts and sustained drip attacks.
**Fix:**
```ts
const current = await redis.incr(key)
if (current === 1) {
  await redis.expire(key, window)
}
```

---

### 5. Storage Column Name Mismatch — Playback Broken
**Files:** `app/api/videos/[videoId]/playback-url/route.ts:84`, `supabase/migrations/0001_initial_schema.sql:116`
**Severity:** CRITICAL
**Details:**
- Schema defines column as `r2_key` (migration 0001:116)
- Route queries `.select('r2_object_key')` (route.ts:84)
- Mismatch → `version.r2_object_key` is `undefined` → signed URL generation fails or 500s
- **Video playback completely broken.**

**Impact:** Users cannot play any videos.
**Fix:** Change route.ts line 84 to:
```ts
const { data: version } = await adminClient
  .from('video_versions')
  .select('r2_key')  // ← Match schema column name
  .eq('id', versionId)
  .single()

// Then use version.r2_key in generateSignedUrl(version.r2_key)
```

---

### 6. Comments RLS Policy Exposes Soft-Deleted Comments
**Files:** `supabase/migrations/0002_rls_policies.sql:224-229`
**Severity:** CRITICAL
**Details:**
`comments_select` policy has no `deleted_at IS NULL` filter. Any agency member querying the table directly via Supabase sees soft-deleted comment content. The architecture states "Comments soft-delete only" but RLS does not enforce it.

**Impact:** Deleted comment content visible to all agency members.
**Fix:**
```sql
-- supabase/migrations/0002_rls_policies.sql line 224-229
CREATE POLICY "comments_select" ON comments
  FOR SELECT USING (
    agency_id IN (
      SELECT agency_id FROM memberships WHERE user_id = auth.uid()
    )
    AND deleted_at IS NULL  -- ← ADD THIS
  );
```

---

### 7. Middleware Sign-In Path Mismatch & Test Route Mismatch
**Files:** `app/middleware.ts:8-9, 109-117`, `app/auth/signin/page.tsx` (actual path)
**Severity:** CRITICAL
**Details:**
- Middleware redirects to `/sign-in` (line 109)
- `PUBLIC_PATHS` includes `/sign-in` and `/sign-up` (lines 8-9)
- Actual app routes are `/auth/signin`, `/auth/register`
- Users get 404 instead of sign-in form
- E2E tests assert on wrong paths; tests pass but hit wrong URLs

**Impact:** Unauthenticated users cannot reach sign-in; redirect loop or 404.
**Fix:** Either:
- **(Option A)** Add Next.js rewrites in `next.config.js`:
  ```js
  rewrites: () => [{
    source: '/sign-in',
    destination: '/auth/signin'
  }, {
    source: '/sign-up',
    destination: '/auth/register'
  }]
  ```
- **(Option B)** Update middleware + PUBLIC_PATHS to use `/auth/signin` and update E2E tests to match

---

### 8. TOCTOU Race Condition on Invitation Accept
**Files:** `app/api/invitations/accept/route.ts:114-131`
**Severity:** CRITICAL
**Details:**
```ts
// Fetch invitation
const invitation = ...
// Check accepted
if (invitation.accepted_at !== null) return 410
// Two concurrent requests both pass this check
// Insert membership (UNIQUE constraint saves first one, 2nd fails)
await memberships.insert(...)
// Update accepted_at (happens for both if steps not transactional)
await invitations.update({ accepted_at: now })
```
Steps 3-4 are not atomic. Race condition window exists between membership insert and `accepted_at` update. If the process crashes, invitation is reusable but membership is created.

**Impact:** Double-acceptance of single invitation; duplicate memberships.
**Fix:** Perform both insert and update in a single Postgres transaction via RPC, or update `accepted_at` *before* inserting membership so second concurrent request fails the lookup.

---

### 9. Missing RLS Test Files (6 Critical Tables)
**Files:** `tests/rls/` (directory)
**Severity:** CRITICAL
**Details:**
Only 4 test files exist: `agencies`, `audit_log`, `comments`, `videos`.
Missing test coverage for these security-critical tables:
- `memberships` — The SECURITY DEFINER fix in 0003 is untested
- `invitations` — No test that agents cannot read foreign-agency invites
- `guest_links` — No test talent cannot read/insert links
- `video_versions` — No test that talent sees only their videos
- `notifications` — No test that users cannot read others' notifications
- `notification_preferences` — No test for permission isolation

**Impact:** CI gate passes with zero coverage of 6/11 tables. Regressions in RLS policies go undetected.
**Fix:** Create `tests/rls/memberships.test.sql`, `invitations.test.sql`, `guest_links.test.sql`, `video_versions.test.sql`, `notifications.test.sql`, `notification_preferences.test.sql` with full CRUD + cross-agency tests.

---

## P2 — Important (Address in S1 or Before S0 Gate)

### 10. Rate Limiting Inconsistencies & Gaps
**Files:** `app/api/auth/reset-password/route.ts:20-21`, `app/api/auth/register/route.ts:33`, `lib/rate-limit.ts:49`

- **[reset-password] No try/catch on rate limit call** → Redis error 500s the route (inconsistent with signin/register)
- **[reset-password] Key naming inconsistent** → `auth:reset-password:${ip}` vs pattern `auth:{endpoint}:ip:{ip}`
- **[register] Rate limit checked mid-validation** → exhausts bucket on invalid form data before all fields validated
- **[signout] No rate limiting** → intended (logout endpoint), but undocumented
- **[rate-limit.ts] Retry-After always returns full window** → always 900s even if 30s left in window (consequence of fixed-window)

### 11. Sentry & PostHog Trace Sampling Too High
**Files:** `instrumentation.ts:5`, `instrumentation-client.ts:5`

- Both set `tracesSampleRate: 1.0` (100%) in all environments
- In production, this creates excessive Sentry quota consumption + latency
- Fix: Use `0.1` (10%) or environment-driven: `parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1')`

### 12. CSP Headers Incomplete
**Files:** `next.config.js:14`

- `script-src` includes `'unsafe-inline'` (weakens XSS protection significantly)
- `script-src` missing `https://js.stripe.com` (Stripe JS will be blocked in S3)
- Missing R2 bucket domain from `connect-src` and `media-src` (video playback will fail)

### 13. Invited Role has No UPDATE/DELETE RLS Policy
**Files:** `supabase/migrations/0002_rls_policies.sql:88-102`

- `invitations` table has SELECT policy but no UPDATE or DELETE policy
- If acceptance flow runs as authenticated user (vs service role), no policy permits `UPDATE invited_at`
- This is potentially correct (service-role-only acceptance) but is undocumented in the migration

### 14. E2E Tests Run After Merge
**Files:** `.github/workflows/playwright.yml:4-6`

- E2E workflow only triggers on `push: branches: [main]` — not on PRs
- Regressions land in main before E2E catches them
- Fix: Add `pull_request: branches: [main]` trigger

### 15. Frontend URL Mismatches
**Files:** `app/auth/register/page.tsx:92`, Multiple E2E tests

- Register form links to `/sign-in` (404) instead of `/auth/signin`
- E2E tests navigate to `/sign-in` and `/sign-up` which don't exist

### 16. Password Reset Error Leakage
**Files:** `app/auth/reset-password/reset-password-form.tsx:29-36`

- Supabase `error_description` URL parameter reflected verbatim in error message
- Exposes Supabase internal errors like "otp_expired" to the user
- Fix: Use generic "Invalid or expired link" message instead

### 17. Auth Fixture Empty & Authenticated Role Tests Missing
**Files:** `tests/e2e/fixtures/auth.ts`, `tests/e2e/middleware-roles.spec.ts`

- `authenticatedPage` fixture shell with no implementation
- E2E signin/register tests manually call `.fill()` and `.press()` repeatedly (no fixture reuse)
- RBAC role tests entirely absent (marked for S1-E2E-001)
- All 6 acceptance criteria in middleware require role-aware authenticated tests

### 18. Video Column Name Risk
**Files:** `supabase/migrations/0001_initial_schema.sql:116` vs schema usage

- Column named `r2_key` but inconsistently referenced in code
- Double-check all references use consistent column name across migrations + routes

### 19. RLS Policies Use Subqueries Not SECURITY DEFINER
**Files:** `supabase/migrations/0002_rls_policies.sql:23-46`

- Only `memberships_select` uses `SECURITY DEFINER` to prevent recursion
- Other policies (`agencies_select`, etc.) use raw `SELECT ... FROM memberships` subqueries
- This works today (recursion broken at `memberships_select`) but creates fragility

### 20. `create_video_version` RPC Lacks Caller Validation
**Files:** `supabase/migrations/0001_initial_schema.sql:257-308`

- Function accepts caller-supplied `p_uploaded_by` without validating it equals `auth.uid()`
- If exposed to authenticated clients, any user could create versions attributed to others
- Add: `IF p_uploaded_by != auth.uid() THEN RAISE EXCEPTION 'Unauthorized'; END IF;`

### 21. Missing Env Var Guard on reset-password Rate Limit
**Files:** `app/api/auth/reset-password/route.ts:21`

- Calls `rateLimit()` directly without try/catch
- If `UPSTASH_REDIS_REST_URL` missing, throws at request time instead of failing open
- Fix: Wrap in try/catch, consistent with signin/register

### 22. Hardcoded E2E Test Credentials
**Files:** `tests/e2e/signin.spec.ts:15-16`

- `const TEST_AGENCY_PASSWORD = process.env.E2E_TEST_AGENCY_PASSWORD || 'TestPass1'`
- Fallback password is a known value in source control
- Remove fallback; throw error if env var not set

---

## P3 — Nice to Have

### Performance & Observability

23. **Rate limit `Retry-After` always returns full window** (`lib/rate-limit.ts:49`) — should return seconds remaining in current window
24. **Redis client created per-request in videos/playback** (`app/api/videos/[videoId]/playback-url/route.ts:54`) — consider module-level singleton
25. **Single Chromium browser in E2E tests** (`playwright.config.ts:17`) — Firefox/WebKit omitted for now
26. **Playwright expect timeout 5s too tight for cold Vercel previews** (`playwright.config.ts:6`) — raise to 10s

### Code Quality & Maintainability

27. **No `pnpm audit` in CI** — would have caught Next.js CVE above
28. **Storage singleton not reset between tests** (`lib/storage.ts:137-145`) — env var mutation could cause test cross-contamination
29. **E2E POM stubs empty** (`tests/e2e/pages/*.ts`) — selectors documented but zero methods
30. **No E2E test cleanup for created users** — orphaned test users accumulate in staging DB
31. **Comments test lacks soft-delete coverage** (`tests/rls/comments.test.sql:61-96`) — no test that `deleted_at` filters results
32. **Hash computation inconsistency** (`invitations/send/route.ts:123` vs `validate/route.ts:27`) — extract shared helper
33. **Token logged to console on email failure** (`invitations/send/route.ts:164`) — plaintext token in Vercel/Sentry logs

### Architecture & UX

34. **Double-nested subquery in `users_select_agency`** (`0002_rls_policies.sql:59-68`) — could use `get_current_user_agency_ids()`
35. **Video `active_version_id` nullable, no default** (`0001_initial_schema.sql:100`) — JOINs without NULL check drop new videos
36. **Signed URL expiry not communicated to client** (`lib/storage.ts`) — client cannot proactively refresh URLs
37. **Reset password success messaging good** ✓ — but "link expired" path shows Supabase error (P2 #16 fix needed)
38. **Consent banner hydration flicker** (`components/cookie-consent-banner.tsx:10`) — banner briefly absent on page load (PECR risk)
39. **Storage test access control assertions tautological** (`app/api/videos/[videoId]/playback-url/route.test.ts:98-123`) — do not invoke route handler
40. **Missing `generateUploadUrl` stub in StorageClient** (`lib/storage.ts:39`) — S1 will need presigned PUT URLs

---

## Verification Checklist

Before S0 Gate, **all P1 issues must be fixed and verified:**

- [ ] **P1.1:** Next.js upgraded to `>=14.2.25` → `pnpm install` → no build errors
- [ ] **P1.2:** Sentry consent-gated in `instrumentation-client.ts` and `app/global-error.tsx`
- [ ] **P1.3:** Rate limiting added to `/invitations/accept`, `/invitations/send`, `/invitations/validate`
- [ ] **P1.4:** Redis rate-limit algorithm fixed (EXPIRE only on first INCR)
- [ ] **P1.5:** Column name mismatch fixed (`r2_key` in route.ts)
- [ ] **P1.6:** Comments RLS policy updated with `deleted_at IS NULL` filter
- [ ] **P1.7:** Middleware redirect + `PUBLIC_PATHS` aligned with actual `/auth/signin` and `/auth/register` routes; E2E tests updated
- [ ] **P1.8:** Invitation accept TOCTOU race condition fixed (atomic transaction or reordering)
- [ ] **P1.9:** RLS test files created for `memberships`, `invitations`, `guest_links`, `video_versions`, `notifications`, `notification_preferences`
- [ ] **All P1 fixes tested:** `pnpm format:check && pnpm type-check && pnpm lint`
- [ ] **Unit tests pass:** `pnpm test`
- [ ] **RLS tests pass:** `supabase test db tests/rls`
- [ ] **E2E tests pass:** `pnpm test:e2e`
- [ ] **CI passes on branch**

---

## Recommended Action Plan

### Immediate (Before S0 Gate)
1. Create `chore/s0-code-review-p1-fixes` branch from `main`
2. Fix all 9 P1 issues (prioritise P1.1, P1.2, P1.3, P1.4 as highest risk)
3. Add missing RLS test files (P1.9)
4. Run all test suites locally, then push
5. Open PR, run `/pr-fix` to trigger Ralph Loop
6. After PR merge, run `node orchestrate.js gate sprint-0` to verify

### S1 Onboarding (Before sprint starts)
- Implement P2 fixes (especially E2E infrastructure: authenticated fixture, role-aware tests)
- Add `generateUploadUrl` to StorageClient interface (video upload feature)
- Document RLS recursion fragility and plan SECURITY DEFINER unification

### S3 Launch Hardening (Before v1.0 production deployment)
- Remove `'unsafe-inline'` from CSP (migrate to nonce-based)
- Unify all RLS policies to use `SECURITY DEFINER` function
- Add Firefox/WebKit to E2E test matrix
- Implement E2E test auto-cleanup and monitoring

---

## Summary of Previous Review Findings (2026-02-22)

All **4 P1 security issues** from the previous auth-focused review have been **resolved**:

✅ **Email format validation** — present in all 4 auth routes
✅ **User enumeration via 409** — returns generic 400, no email-specific 409
✅ **Error message leakage** — all Supabase errors logged server-side only, generic messages to client
✅ **Middleware logs unredacted errors** — extracts `.message` string, no raw objects logged

---

## New Issues NOT Caught in Previous Review

This full codebase review surfaced **9 critical P1 issues** that previous auth-focused review missed:

1. Next.js CVE (middleware auth bypass)
2. Sentry/PostHog GDPR violation (no consent gate)
3. Invitation endpoints missing rate limiting (3 endpoints)
4. Rate limiting algorithm broken
5. Video playback column mismatch
6. Soft-deleted comments visible via RLS
7. Middleware route path mismatch
8. TOCTOU race on invitation accept
9. 6 tables with zero RLS test coverage

**Lesson:** Focused reviews catch auth-layer issues well; full-stack reviews are needed to surface infrastructure, RLS, and infrastructure configuration gaps.

