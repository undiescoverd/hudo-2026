# Stripe Webhook Security Audit (S3-SEC-003)

Date: 2026-07-02
Scope: `app/api/webhooks/stripe/route.ts`, `lib/billing.ts`, `lib/stripe.ts`, and every
client-facing file that could theoretically read `STRIPE_SECRET_KEY`.

## Summary

| Area | Verdict |
|---|---|
| Signature validation | **PASS** — no bypass path |
| Idempotency (duplicate-event safety) | **PASS** — ordering was already correct |
| `STRIPE_SECRET_KEY` client-bundle segregation | **PASS** — server-only, never exposed |
| Retry contract (silent no-ops) | **FAIL → FIXED** — two handlers violated the documented contract |

## 1. Signature validation

`app/api/webhooks/stripe/route.ts` `POST`:

1. Reads the body with `request.text()` — the raw bytes are never `JSON.parse`d before the
   signature check, so Stripe's HMAC (computed over the exact raw payload) can't be defeated
   by a re-serialized body.
2. Missing `stripe-signature` header → `400` immediately, before Stripe SDK or any handler
   runs (line ~88).
3. Missing `STRIPE_WEBHOOK_SECRET` env var → `500` (server misconfigured), never falls through
   to "trust the event anyway" (line ~93).
4. Signature verification is `getStripe().webhooks.constructEvent(rawBody, sigHeader,
   webhookSecret)` — the official Stripe SDK primitive, no custom re-implementation. Any
   `constructEvent` throw (bad signature, tampered body, expired timestamp) → `400` (line
   ~101-105).
5. **No code path reaches event dispatch without passing through `constructEvent`.** There is
   no `NODE_ENV`, feature-flag, or test-only branch that skips verification — confirmed by
   grep (`NODE_ENV|bypass|skip.*sig` → zero matches in the route file).

**Verdict: PASS.** Every dispatch path is gated by a successful `constructEvent` call; invalid
or missing signatures always return 400 before any handler executes.

## 2. Idempotency (duplicate-event safety)

Mechanism: Redis key `stripe:processed:<event.id>`, 24h TTL. Note: this is *shorter* than
Stripe's ~72h retry window, so an unusually late retry (>24h after the original attempt) could
re-process an event whose claim has already expired. This is harmless — every handler performs
an absolute (not incremental) `UPDATE`, so re-running one is idempotent at the data layer (see
the concurrent-duplicate note below for the same argument applied to the sub-24h race).

- **Pre-check** (`isAlreadyProcessed`): a non-mutating `GET`. If the key exists, the route
  returns `200 { skipped: true }` immediately without re-running the handler — replayed events
  do not produce duplicate DB writes.
- **Post-success claim** (`claimProcessed`): a `SET NX` written **only after** the handler
  resolves without throwing (route.ts lines 113-148). If the handler throws, control returns
  via the `catch` block at line 141 and `claimProcessed` is **never called** — confirmed by
  the existing test `does not write idempotency SET when handler throws`
  (`app/api/webhooks/stripe/route.test.ts:283`), which asserts zero `SET` commands reach Redis
  when a handler fails.
- **Ordering was already correct before this task's fix.** The retry-contract fix (see §4)
  only changes *when* two previously-silent paths throw — it does not touch the
  pre-check/post-claim ordering, which was sound on inspection. Re-verified after the fix:
  `pnpm exec tsx --test app/api/webhooks/stripe/route.test.ts` — 11/11 passing, including the
  no-claim-on-throw test.
- **Concurrent-duplicate race (documented, accepted):** two requests for the same event ID can
  both pass the pre-check before either writes the claim. All four handlers perform absolute
  (not incremental) `UPDATE`s, so a double-run is idempotent at the data layer — a harmless
  double-write, not a double-charge or double-count.
- **Redis-unavailable fail-open (documented, accepted):** if Redis is down, both the pre-check
  and the post-claim log-and-continue rather than blocking the webhook. This trades a small
  duplicate-processing risk (mitigated by the idempotent absolute-UPDATE design above) for
  availability — a Redis outage must not cause Stripe to see repeated 500s and back off retries.

**Verdict: PASS.** No changes required; the zero-row/throw contract that this task hardens
(§4) also **improves** idempotency safety indirectly — a handler that now throws instead of
silently returning is guaranteed not to have its event marked processed, so Stripe's retry can
still succeed once the transient condition (e.g. out-of-order delivery) resolves.

## 3. `STRIPE_SECRET_KEY` client-bundle segregation

- `grep -rn "STRIPE_SECRET_KEY" app/ components/ lib/ next.config.js` shows the variable is
  read in exactly one place: `lib/stripe.ts:42` (`getStripe()`, instantiated lazily inside the
  function body, not at module scope — avoiding the `new Resend('')`-style build-time crash
  documented in CLAUDE.md's Failure Log).
- Every caller of `getStripe()` is a server-only file: `app/api/webhooks/stripe/route.ts`,
  `app/api/billing/portal/route.ts`, `app/api/agencies/[id]/billing/route.ts`. None carry
  `'use client'`.
- `grep -rln "'use client'" app/ components/` intersected with any Stripe import → zero
  results.
- `next.config.js` has no `env:` block or `publicRuntimeConfig` that would re-expose a
  server-only variable to the client bundle.
- Existing regression test `app/api/agencies/[id]/billing/route.test.ts` already asserts the
  secret key is never interpolated into a `NextResponse` body (`does not return Stripe secret
  key in any response`).
- Only `NEXT_PUBLIC_*`-prefixed Stripe values (the publishable key) are intended for client
  use, per CLAUDE.md's Critical Architecture Rules — no such client-facing publishable-key
  usage was found to audit in this pass (checkout is server-initiated via
  `app/api/agencies/[id]/billing/route.ts`, not client-side Stripe.js in this codebase today).

**Verdict: PASS.** `STRIPE_SECRET_KEY` never reaches client-served code or responses.

## 4. Retry-contract fix (silent no-ops → throw + Sentry)

`lib/billing.ts`'s own header comment states the contract: *"throw so Stripe retries."* Two
handlers violated it by `console.error`-and-`return`ing instead of throwing on a missing
required field:

- `handleCheckoutSessionCompleted` — a `checkout.session.completed` event missing `customer`
  or `subscription` returned silently. The agency never received `stripe_customer_id` /
  `stripe_subscription_id`, and because the event was never re-thrown, the caller (the webhook
  route) treated it as success — **the idempotency claim would have been written**, so even a
  legitimate Stripe retry with corrected data would have been skipped by the pre-check.
- `handleInvoicePaymentFailed` — an `invoice.payment_failed` event missing `customer` returned
  silently. `subscription_status` was never flipped to `past_due`, again with the
  claim-would-be-written side effect above.

### Fix applied

Both paths now:
1. Build a specific `Error` naming the missing field and the Stripe object ID (session ID /
   invoice ID), so the 500 log and the Sentry event are actionable without replaying the
   payload.
2. Call `Sentry.captureException(err, { extra: { ... } })` **before** throwing, so the failure
   is observable in Sentry even if the on-call engineer only checks there (not raw logs).
3. `throw` — which propagates to the route's `catch` block, returns `500`, and — per §2 — skips
   the idempotency claim, so Stripe's retry can succeed once the underlying condition clears
   (e.g. Stripe backfills `customer`/`subscription` on a corrected retry, or the operator fixes
   checkout-session creation to always attach them).

### Sentry wiring

Followed the existing DI pattern from `lib/storage-reconcile.ts` (not a raw static import at
every call site) because the unit-test suite (`node:test` via `tsx`, Node 20) has no module-
mocking primitive — `BillingDeps` gained an optional `sentry?: { captureException }` field,
defaulting to a static `import * as Sentry from '@sentry/nextjs'` at the top of `lib/billing.ts`
(same import used by `app/global-error.tsx`). Tests inject a stub and assert `calls.length`.

### Untouched by design (plan-tier trap)

`getPlanFromPrice`, `LOOKUP_KEY_TO_PLAN`, and `LEGACY_PRICE_ID_TO_PLAN` in `lib/stripe.ts` were
**not modified**. Per CLAUDE.md's Failure Log, `LEGACY_PRICE_ID_TO_PLAN` grandfathers real
paying customers whose archived Stripe prices have no `lookup_key` — deleting entries there
silently downgrades them to freemium. This audit only touched the two silent-`return` sites in
`lib/billing.ts`'s event handlers.

## Verification

```
pnpm format:check && pnpm type-check && pnpm lint && pnpm test   # all green (826/826 tests)
pnpm build                                                        # succeeds (CI's real gate)
```

New/updated tests (`lib/billing.test.ts`):
- `throws (not silently returns) when customer is missing on the completed session, and
  reports to Sentry (S3-SEC-003)`
- `throws (not silently returns) when subscription is missing on the completed session, and
  reports to Sentry (S3-SEC-003)`
- `throws (not silently returns) when invoice has no customer, and reports to Sentry
  (S3-SEC-003)` (replaces the old `skips and logs when invoice has no customer` test, which
  asserted the now-fixed silent-return behavior)

Existing test reused as evidence for §2 (idempotency ordering unaffected by this fix):
`app/api/webhooks/stripe/route.test.ts` → `does not write idempotency SET when handler throws`.
