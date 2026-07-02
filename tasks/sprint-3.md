# Sprint 3 — Billing, Compliance & Security Hardening

**Status: Not Started**

**Gate:** A free-tier agency cannot add a sixth agent. A paid agency can. DPA must be accepted before plan activation. GDPR erasure anonymises audit log. All rate limits are active. Storage reconciliation job runs without errors.

---

> **Migration numbering (verified 2026-06-17):** existing migrations run 0001–0016, then the uncommitted `0020_agencies_founding_member.sql` already occupies **0020**. Free slots: **0017, 0018, 0019**. COMPLY-001 → `0017_audit_log_indexes.sql`; BILLING-003 → `0019_agencies_grace_period.sql`. Do NOT reuse 0020. Apply migrations via the `/apply-migration` flow (MCP `apply_migration` → both hudo-dev + hudo-staging), never the SQL editor.

## Tasks

### WAVE 1 — Billing Foundation + Compliance + Cookie Consent (parallel, no blockers)

---

- [x] **S3-BILLING-001** — Configure Stripe

TASK_ID: S3-BILLING-001
TITLE: Configure Stripe
BRANCH: feat/s3-billing-001-configure-stripe
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Stripe products created: Freemium (free), Starter (£49/mo), Studio (£149/mo), Agency Pro (£349/mo)
  - Stripe Tax enabled for UK VAT on all paid products
  - STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET stored in Vercel env (preview + production); never in client bundle
  - NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY added as the only client-visible Stripe key
  - pnpm type-check && pnpm lint green
FILES:
  - .env.local (document keys only — never commit values)
  - docs/stripe-setup.md
NOTES: M — pure config task; no application code beyond documenting env vars and adding stripe package. Run security-review gate before merge (keys + billing surface). Must precede BILLING-002/004/006.

---

- [x] **S3-COMPLY-001** — Build audit log

TASK_ID: S3-COMPLY-001
TITLE: Build audit log
BRANCH: feat/s3-comply-001-audit-log
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - audit_log TABLE ALREADY EXISTS (0001_initial_schema.sql) with all required columns and insert-only RLS (0002_rls_policies.sql — SELECT for owners/admin_agents, NO client INSERT/UPDATE/DELETE; inserts via service role only). DO NOT recreate the table or RLS. NOTE: resource_id is NOT NULL in the existing schema (not nullable) — logEvent must always pass a resource_id.
  - Migration 0017_audit_log_indexes.sql: adds the only genuinely-missing pieces — CREATE INDEX IF NOT EXISTS on audit_log(agency_id) and audit_log(created_at). Nothing else.
  - lib/audit.ts exports logEvent(action, resourceType, resourceId, metadata) — resolves agency_id + actor from current session; inserts via the SERVICE-ROLE client (mirror lib/notifications.ts: createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY)), since RLS blocks authenticated-client inserts. logEvent must never throw into the request path — failures log + swallow.
  - Instrument all five: video status changes, video version uploads, member invitations, role changes, guest link creation/revocation
  - Entries are immutable — no update or delete RLS policy exists (verify only; do not add)
  - pnpm type-check && pnpm lint green
FILES:
  - supabase/migrations/0017_audit_log_indexes.sql   (indexes only — table + RLS already exist)
  - lib/audit.ts
  - app/api/videos/[videoId]/status/route.ts            (status_changed — dedicated status route)
  - app/api/videos/upload/complete/route.ts             (version_uploaded)
  - app/api/invitations/send/route.ts                   (invitation_sent)
  - app/api/agencies/[id]/members/route.ts              (role_changed)
  - app/api/videos/[videoId]/guest-links/route.ts       (guest_link_created)
  - app/api/guest-links/[id]/route.ts                   (guest_link_revoked)
NOTES: M — security surface (RLS, insert-only). Run devsecops-security-engineer gate before merge. COMPLY-002 blocked on this. CORRECTION (verified 2026-06-17): the original 0017_audit_log.sql table migration was wrong — the table predates this task. Valid action values already enumerated in 0001: status_changed, version_uploaded, invitation_sent, invitation_accepted, role_changed, guest_link_created, guest_link_revoked, billing_plan_changed, billing_payment_failed. resource_type values: video, comment, membership, guest_link, billing.

---

- [ ] **S3-COMPLY-003** — Build cookie consent banner

TASK_ID: S3-COMPLY-003
TITLE: Build cookie consent banner
BRANCH: feat/s3-comply-003-cookie-consent
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Banner appears on first visit for unauthenticated and authenticated users who have not yet consented
  - Session/auth cookies always active (not gated)
  - PostHog script must not load (not just event-blocked) before consent is given
  - Consent preference stored in localStorage under key "hudo_cookie_consent"
  - Banner disappears after accept or reject; preference persists across page reloads
  - pnpm type-check && pnpm lint green
FILES:
  - components/cookie-consent-banner.tsx   (ALREADY EXISTS — mounted in app/layout.tsx:17)
  - lib/posthog.ts                          (ALREADY consent-gated: CONSENT_KEY='hudo_cookie_consent', initPostHog() no-ops without consent)
NOTES: VERIFY-ONLY (confirmed 2026-06-17) — already built and wired, NOT a build task. components/cookie-consent-banner.tsx is mounted in app/layout.tsx; PostHog is consent-gated in lib/posthog.ts; guest layout is consent-aware. Handle as a quick checklist (banner shows pre-consent, PostHog script does not load before consent, preference persists under 'hudo_cookie_consent'), not an agent. NOTE: actual paths differ from the original spec (components/cookie-consent-banner.tsx not components/consent/CookieConsentBanner.tsx; lib/posthog.ts not lib/consent.ts).

---

### WAVE 2 — Billing Integration (blocked by BILLING-001)

---

- [x] **S3-BILLING-002** — Build Stripe webhook handler

TASK_ID: S3-BILLING-002
TITLE: Build Stripe webhook handler
BRANCH: feat/s3-billing-002-webhook-handler
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: S3-BILLING-001
ACCEPTANCE_CRITERIA:
  - Route POST /api/webhooks/stripe with raw body parsing (no JSON middleware)
  - Stripe signature validation — reject missing/invalid Stripe-Signature header with 400
  - Event handlers: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed
  - Idempotency: skip already-processed events using Stripe event ID
  - Syncs subscription plan, status, and renewal date to agencies table on each event
  - Returns 200 for all successfully processed and idempotently skipped events
  - pnpm type-check && pnpm lint green
FILES:
  - app/api/webhooks/stripe/route.ts
  - lib/stripe.ts
  - lib/billing.ts
NOTES: L — security surface (signature validation, billing state). Run devsecops-security-engineer gate before merge. BILLING-003/005 and SEC-003 blocked on this.

---

- [x] **S3-BILLING-004** — Collect legal entity data for invoices

TASK_ID: S3-BILLING-004
TITLE: Collect legal entity data for invoices
BRANCH: feat/s3-billing-004-legal-entity
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: S3-BILLING-001
ACCEPTANCE_CRITERIA:
  - Settings → Billing: form collects legal name, billing address, VAT number (optional) before plan upgrade
  - Data passed to Stripe customer metadata on checkout
  - Cannot proceed to checkout without legal_name and billing_address filled
  - pnpm type-check && pnpm lint green
FILES:
  - components/billing/LegalEntityForm.tsx
  - app/api/agencies/[id]/billing/route.ts
NOTES: M — NO new migration needed: legal_name, billing_address, vat_number, dpa_accepted_at, dpa_accepted_ip already exist on agencies (0001_initial_schema.sql). is_founding_member added via 0020_agencies_founding_member (applied 2026-06-16). Security surface (billing data, Stripe customer creation) — run devsecops-security-engineer gate before merge.

---

- [x] **S3-BILLING-006** — DPA acceptance gate

TASK_ID: S3-BILLING-006
TITLE: DPA acceptance gate
BRANCH: feat/s3-billing-006-dpa-gate
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: S3-BILLING-001
ACCEPTANCE_CRITERIA:
  - Data Processing Agreement presented to agency owner before any paid plan activates
  - Owner must tick an explicit checkbox to accept
  - Acceptance timestamp and request IP stored on agencies.dpa_accepted_at + agencies.dpa_accepted_ip
  - Plan upgrade cannot proceed without DPA acceptance (enforced server-side)
  - pnpm type-check && pnpm lint green
FILES:
  - components/billing/DpaAcceptanceModal.tsx
  - app/api/agencies/[id]/dpa-accept/route.ts
NOTES: M — depends on BILLING-004 for the migration (dpa_accepted_at / dpa_accepted_ip columns). Can be built in parallel with BILLING-004 if migration is applied first.

---

### WAVE 3 — Plan Gates + Billing UI + Compliance (blocked by WAVE 2)

---

- [x] **S3-BILLING-003** — Implement full plan feature gates

TASK_ID: S3-BILLING-003
TITLE: Implement full plan feature gates
BRANCH: feat/s3-billing-003-plan-gates
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: S3-BILLING-002
ACCEPTANCE_CRITERIA:
  - Storage hard cap enforced at plan level — upload blocked when agency storage_usage >= plan limit
  - Grace period logic: 7-day access window after invoice.payment_failed, then block uploads and new invites
  - grace_period_ends_at stored on agencies table; computed from invoice.payment_failed event timestamp
  - All gate checks read from agencies.plan + agencies.grace_period_ends_at (not re-queried from Stripe per request)
  - pnpm type-check && pnpm lint green
FILES:
  - supabase/migrations/0019_agencies_grace_period.sql
  - lib/plan-gates.ts
  - app/api/videos/upload/presign/route.ts (storage gate)
  - app/api/invitations/route.ts (invite gate)
  - lib/billing.ts (grace period update on webhook)
NOTES: M — extends S2-GATE-001 seat gates. Run devsecops-security-engineer gate before merge.

---

- [x] **S3-BILLING-005** — Build billing UI

TASK_ID: S3-BILLING-005
TITLE: Build billing UI
BRANCH: feat/s3-billing-005-billing-ui
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: S3-BILLING-002
ACCEPTANCE_CRITERIA:
  - Settings → Billing page: current plan name, usage bars (agents, talent, storage vs plan limits), next renewal date, payment method summary
  - Upgrade/downgrade links open Stripe Customer Portal
  - Invoice history via Stripe Customer Portal
  - Billing page only accessible to agency owner role
  - pnpm type-check && pnpm lint green
FILES:
  - app/(dashboard)/settings/billing/page.tsx
  - components/billing/BillingOverview.tsx
  - components/billing/UsageBars.tsx
  - app/api/billing/portal/route.ts
NOTES: M — Stripe Customer Portal URL generation happens server-side only.

---

- [ ] **S3-COMPLY-002** — Implement right-to-erasure

TASK_ID: S3-COMPLY-002
TITLE: Implement right-to-erasure
BRANCH: feat/s3-comply-002-right-to-erasure
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: S3-COMPLY-001
ACCEPTANCE_CRITERIA:
  - API endpoint DELETE /api/users/:id/data — owner or admin_agent auth check enforced
  - Anonymise audit log: replace actor_name → "Deleted User", set actor_id → null
  - Revoke all Supabase auth sessions for the user
  - Remove all rows from memberships for the user
  - Delete personal data from users table (preserve id as tombstone for referential integrity)
  - After erasure: user cannot sign in; audit log shows "Deleted User"; data not retrievable via any API endpoint
  - pnpm type-check && pnpm lint green
FILES:
  - app/api/users/[userId]/data/route.ts
  - lib/erasure.ts
NOTES: L — security surface (auth session revocation, cascading deletes). Run devsecops-security-engineer gate before merge.

---

### WAVE 4 — Security Hardening (mixed blockers)

---

- [x] **S3-SEC-001** — Implement API rate limiting (full audit)

TASK_ID: S3-SEC-001
TITLE: Implement API rate limiting (full audit)
BRANCH: feat/s3-sec-001-rate-limiting-audit
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - All rate-limited endpoints confirmed Redis-backed via Upstash and return 429 + Retry-After header
  - Upload: 10 requests/user/hr
  - Comments: 60 requests/user/hr
  - Guest link validation: 20 requests/IP/min
  - Auth endpoints (sign-in, sign-up, magic-link): confirm limits in place
  - Any endpoint missing a limit gets one added; any limit not returning Retry-After is fixed
  - checkRateLimit in lib/api-helpers.ts no longer fails open on Redis errors: fail-closed (503 + Retry-After) for auth + invitation endpoints; posture per endpoint class documented in route headers
  - Comment routes' inline fail-closed rate-limit blocks migrated onto the shared helper (behaviour unchanged)
  - app/api/dashboard/videos/route.ts gets a rate limit (open TODO at line 14)
  - Unit test: throwing Redis mock → auth endpoints 503, non-auth allow
  - pnpm type-check && pnpm lint green
FILES:
  - lib/rate-limit.ts
  - lib/api-helpers.ts
  - app/api/videos/upload/presign/route.ts
  - app/api/videos/[videoId]/comments/route.ts
  - app/api/comments/[id]/route.ts
  - app/api/guest-links/[token]/validate/route.ts
  - app/api/dashboard/videos/route.ts
  - app/api/auth/route.ts (if applicable)
NOTES: M — security surface. Run devsecops-security-engineer gate before merge. Extended 2026-07-02 (codebase audit): auth rate limiting currently fails open (lib/api-helpers.ts:22-24 swallows Redis errors) — fail-closed fix folded in here.

---

- [ ] **S3-SEC-002** — Confirm R2 bucket is fully private

TASK_ID: S3-SEC-002
TITLE: Confirm R2 bucket is fully private
BRANCH: feat/s3-sec-002-r2-private-audit
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Verify hudo-staging and hudo-prod buckets have no public bucket policy (no public-read ACL)
  - Verify all playback URLs are signed (15 min TTL) — no direct R2 URL ever returned to client
  - Verify guest playback routes through the signing proxy (/api/videos/:id/playback-url) not direct R2
  - Verify CORS config rejects requests from non-app domains
  - Document findings in docs/r2-security-audit.md
FILES:
  - docs/r2-security-audit.md
NOTES: S — audit + doc task; minimal code changes expected. May surface fixes that need separate PRs.

---

- [x] **S3-SEC-003** — Stripe webhook security audit

TASK_ID: S3-SEC-003
TITLE: Stripe webhook security audit
BRANCH: feat/s3-sec-003-webhook-security-audit
MODEL: haiku-4.5
STATUS: done
BLOCKED_BY: S3-BILLING-002
ACCEPTANCE_CRITERIA:
  - Confirm signature validation present on every webhook code path (no bypass possible)
  - Confirm idempotency prevents duplicate records for replayed events
  - Confirm STRIPE_SECRET_KEY absent from client bundle (grep + bundle analysis)
  - handleCheckoutSessionCompleted and handleInvoicePaymentFailed (lib/billing.ts) no longer silently return on missing customer/subscription — they throw (per the file's own "throw so Stripe retries" contract) + Sentry.captureException
  - Unit test: checkout-completed with missing customer throws; captureException called
  - Findings documented; any gaps fixed in the same PR
  - pnpm type-check && pnpm lint green
FILES:
  - app/api/webhooks/stripe/route.ts
  - lib/billing.ts
  - docs/stripe-security-audit.md
NOTES: S — audit task on top of BILLING-002. Run devsecops-security-engineer gate before merge. Extended 2026-07-02 (codebase audit): silent no-ops in lib/billing.ts (~line 154, ~line 294) break the Stripe retry contract — checkout completes but agency never gets stripe_customer_id; past_due never recorded.

---

- [x] **S3-SEC-004** — Storage reconciliation job

TASK_ID: S3-SEC-004
TITLE: Storage reconciliation job
BRANCH: feat/s3-sec-004-storage-reconciliation
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Nightly cron job at /api/cron/storage-reconcile recalculates actual R2 usage by agency prefix
  - Compares actual usage to storage_usage in agencies table
  - Logs drift >1MB to Sentry (does not auto-correct)
  - CRON_SECRET validation on the endpoint (matches existing cron pattern)
  - Vercel cron schedule: 0 2 * * * (2am UTC daily — Hobby plan compatible)
  - pnpm type-check && pnpm lint green
FILES:
  - app/api/cron/storage-reconcile/route.ts
  - vercel.json (cron entry)
NOTES: M — depends on R2 creds in env (already present). Hobby plan = max daily frequency (0 0/2 * * *). Log drift to Sentry only; never auto-correct.

---

- [x] **S3-SEC-005** — Fix privilege escalation in member-add route

TASK_ID: S3-SEC-005
TITLE: Fix privilege escalation in member-add route
BRANCH: feat/s3-sec-005-member-role-escalation
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Grantable roles depend on caller role: owner may grant owner|admin_agent|agent; admin_agent may grant agent only (currently an admin_agent can mint an owner — app/api/agencies/[id]/members/route.ts line 96 vs 118)
  - admin_agent POST with role 'owner' or 'admin_agent' → 403; owner POST with any of the three → 201
  - Audit mislabel fixed: member add keeps action 'role_changed' (0001 enum has no member_added) but adds metadata.event: 'member_added'
  - Route unit tests updated to cover the caller-role matrix
  - pnpm type-check && pnpm lint && pnpm test green
FILES:
  - app/api/agencies/[id]/members/route.ts
  - app/api/agencies/[id]/members/route.test.ts
NOTES: S — real security bug found in 2026-07-02 codebase audit (verified). Security surface — run hudo-security-reviewer gate before merge.

---

- [x] **S3-SEC-006** — Wire Sentry to route errors + swallowed failures

TASK_ID: S3-SEC-006
TITLE: Wire Sentry to route errors + swallowed failures
BRANCH: feat/s3-sec-006-sentry-wiring
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - instrumentation.ts exports onRequestError (Sentry.captureRequestError) so route errors reach Sentry
  - Sentry.captureException added to the four fire-and-forget paths: lib/audit.ts:86 (audit insert failure — compliance-relevant), app/api/guest/[token]/playback-url/route.ts:117, app/api/videos/[videoId]/versions/[versionId]/comments/route.ts:273 (notification enqueue), app/api/invitations/accept/route.ts:127-130 (users-row insert drift)
  - Swallowed paths still never throw into the request path (behaviour unchanged; observability added)
  - pnpm type-check && pnpm lint && pnpm test green
FILES:
  - instrumentation.ts
  - lib/audit.ts
  - app/api/guest/[token]/playback-url/route.ts
  - app/api/videos/[videoId]/versions/[versionId]/comments/route.ts
  - app/api/invitations/accept/route.ts
NOTES: S — found in 2026-07-02 codebase audit: Sentry.init exists but no onRequestError export; only 2 files ever call captureException. Security surface (app/api/) — run hudo-security-reviewer gate before merge.

---

### Deferred (from 2026-07-02 codebase audit — documented, not scheduled)

- **Source-pattern test remediation:** ~18 `app/api/**/route.test.ts` files regex `fs.readFileSync` source instead of invoking handlers, plus tautological status assertions. High effort; the e2e layer addresses the same risk class more cheaply. Revisit after Playwright e2e is real.
- **zod/validation standardization:** no validator library anywhere; validation is hand-rolled but functional. Big churn, modest payoff.
