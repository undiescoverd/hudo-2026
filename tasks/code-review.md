# Code Review — Sprint 0 Completion

**Date:** 2026-02-22
**Reviewers:** 3 parallel agents (Security & Auth, Database & RLS, Frontend & Config)
**Status:** Sprint 0 architecturally sound; minor refinements recommended before production

---

## Summary

| Layer | Status | P1 Issues | P2 Issues | P3 Issues |
|---|---|---|---|---|
| **Security & Auth** | ✓ Sound | 4 (validation, enumeration, logging) | 3 (missing routes, rate limiting) | 5 (test gaps, comments) |
| **Database & RLS** | ✓ PASS | 0 | 1 (indexes deferred) | 3 (test coverage) |
| **Frontend & Config** | ✓ PASS | 0 | 3 (Slack guards, E2E gaps) | 1 (return types) |
| **OVERALL** | ✓ Ready | **4 minor** | **7 expected** | **9 quality** |

---

## P1 — Security/Critical Issues

All fixable; recommend completing before merging S0-AUTH-002 PR.

### 1. Email Format Validation Missing
- **Files:** `app/api/auth/register/route.ts:26` + `app/auth/register/page.tsx:12`
- **Issue:** Only presence check; invalid emails like `@example.com` accepted
- **Impact:** User confusion, server-side rejection appears as generic error
- **Fix:** Add email regex validation to both client and server
- **Effort:** Low
- **Task Created:** S0-REVIEW-001-P1

### 2. User Enumeration via Duplicate Email Error
- **File:** `app/api/auth/register/route.ts:64-68`
- **Issue:** Returns 409 "email already exists" — enables account enumeration
- **Impact:** Competitor can scrape registered emails
- **Fix:** Return generic 400 error "Registration failed" for all failures
- **Effort:** Low
- **Task Created:** S0-REVIEW-001-P1

### 3. Error Messages Leak Service Details
- **File:** `app/api/auth/register/route.ts:70, 84`
- **Issue:** Passes Supabase error directly to client
- **Impact:** Information disclosure of internal structure
- **Fix:** Generic "Registration failed" message; log actual error server-side only
- **Effort:** Low
- **Task Created:** S0-REVIEW-001-P1

### 4. Middleware Logs Unredacted Errors
- **File:** `app/middleware.ts:73`
- **Issue:** Full error object logged; may contain sensitive data
- **Impact:** Leaks to logs/monitoring
- **Fix:** Log only error type + message, not full object
- **Effort:** Low
- **Task Created:** S0-REVIEW-001-P1

---

## P2 — Architecture Deviations

### From Security & Auth (Expected — S0 scope)

**S0-AUTH-003:** Sign-in/Sign-out Routes Missing (`not_started`)
- Blocks users from logging back in after registration
- High priority to unblock full auth flow
- Estimated effort: Medium (2-3 routes + client pages)

**S0-AUTH-004:** Rate Limiting Not Implemented (`not_started`, blocked by S0-INFRA-011)
- CLAUDE.md critical rule: "Rate limiting via Upstash Redis on all auth endpoints"
- Brute force surface on registration and future sign-in
- Depends on Redis task first

### From Frontend & CI (Actionable now)

**Slack Webhook Guards Missing** (Recommendation: S0-REVIEW-002-P2)
- **Files:** `ci.yml`, `playwright.yml`, `slack-notify.yml`
- **Issue:** Workflows fail if `secrets.SLACK_WEBHOOK_URL` not set
- **Fix:** Add conditional `if: secrets.SLACK_WEBHOOK_URL != ''` to Slack steps
- **Effort:** Low
- **Task Created:** S0-REVIEW-002-P2

**E2E Test Coverage Gaps** (Recommendation: S0-REVIEW-002-P2)
- `tests/e2e/register.spec.ts` missing: successful registration, duplicate email error
- Add 3 test cases (happy path, duplicate email, session persistence)
- Effort: Medium
- **Task Created:** S0-REVIEW-002-P2

### From Database (Expected — S0-DB-004 deferred)

**Foreign Key Indexes Missing** (12 columns)
- Task S0-DB-004 ("Add full index coverage") deferred to Sprint 1 ✓
- Correctly sequenced; no action needed for S0

---

## P3 — Code Quality

Refinement recommendations; lower priority.

### From Security & Auth

**S0-REVIEW-003-P3:** `route.test.ts` Lacks Integration Tests
- Currently only tests `validatePassword` function
- Missing: duplicate email, user creation, API response, error cases
- **Fix:** Add integration test suite for `POST /api/auth/register`
- **Effort:** Medium

**S0-REVIEW-003-P3:** Missing Email Format Check (Client-side)
- `app/auth/register/page.tsx:12` only checks presence
- Should mirror server validation for UX
- **Fix:** Add email regex check
- **Effort:** Low

**S0-REVIEW-003-P3:** fullName Not Normalized Like Email
- `app/api/auth/register/route.ts:79` — email gets `.toLowerCase()`, fullName doesn't
- **Fix:** Apply `.trim().replace(/\s+/g, ' ')` to normalize spaces
- **Effort:** Low

**S0-REVIEW-003-P3:** Missing HTTP Status Constants
- Status codes are magic numbers (400, 409, 500)
- **Optional improvement:** Create `lib/http-status.ts` constant
- **Effort:** N/A (style, non-blocking)

**S0-REVIEW-003-P3:** Missing JSDoc on API Route
- `app/api/auth/register/route.ts` lacks parameter/return documentation
- **Fix:** Add JSDoc block with @param, @returns, @throws
- **Effort:** Low

### From Frontend

**S0-REVIEW-003-P3:** Missing Return Type Annotations
- `lib/auth.ts`: `createClient()`, `signInWithPassword()`, `signOut()` missing return types
- `lib/utils.ts`: `cn()` missing return type
- **Impact:** Type-check passes (inference works), but explicit is better practice
- **Fix:** Add `: SupabaseClient`, `: Promise<...>`, `: string`
- **Effort:** Low

**S0-REVIEW-003-P3:** Playwright Config Missing Explicit `.env.local` Load
- Works implicitly (Playwright uses dotenv internally)
- **Recommendation:** Add explicit `dotenv.config({ path: '.env.local' })` for clarity
- **Effort:** Low

### From Database

**S0-REVIEW-003-P3:** Soft-Delete Test Verification Incomplete
- `tests/rls/comments.test.sql:118-123` verifies UPDATE to `deleted_at` succeeds
- **Missing:** Verify subsequent SELECT queries exclude soft-deleted rows
- **Note:** Design choice — app layer responsible for WHERE `deleted_at IS NULL`
- **Fix (optional):** Add test comment documenting this assumption
- **Effort:** Low

---

## Critical Rules Compliance Checklist

| CLAUDE.md Rule | Status | Notes |
|---|---|---|
| **Video never touches Vercel** | ✅ | N/A (no storage layer in S0) |
| **Multi-tenancy via `memberships`** | ✅ | Schema correct; app-layer validation deferred to S0-AUTH-006 |
| **Guests have zero Supabase access** | ✅ | Design correct; future guest routes must bypass auth |
| **Audit log insert-only** | ✅ | RLS enforces; no bugs found |
| **Stripe keys never on client** | ✅ | N/A (payments in S3) |
| **PostHog consent-gated** | ✅ | Correctly implemented; script doesn't load before consent |
| **Rate limiting on auth/upload** | ⚠️ | Missing (S0-AUTH-004); expected; depends on Redis |
| **Version numbers via RPC** | ✅ | Schema in place; not yet used (S1+) |
| **Comments soft-delete only** | ✅ | Columns + soft-delete pattern established |
| **Service role key absent from client** | ✅ | **Exemplary**: Only used server-side |

---

## Recommended Reading

- **Agent 1 (Security & Auth):** Full review in agent output; focus on P1 findings for immediate action
- **Agent 2 (Database & RLS):** Full review in agent output; all P1 findings = 0 (excellent security posture)
- **Agent 3 (Frontend & Config):** Full review in agent output; focus on CSP headers (complete) and PostHog consent gate (correct)

---

## Next Steps (Status: Complete)

1. ✅ Create follow-up tasks in sprint-0.md for P1/P2/P3 items
2. ✅ Update CLAUDE.md with architectural patterns (soft-delete, guest route isolation)
3. ✅ Verify GitHub secrets (LINEAR_API_KEY, SLACK_WEBHOOK_URL) — confirmed set
4. ✅ Schedule work: P1 before S0-AUTH-002 merge; P2+P3 before S0 gate
