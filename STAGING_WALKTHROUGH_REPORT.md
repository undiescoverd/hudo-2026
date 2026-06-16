# Staging Walkthrough Report — Autonomous Playwright Drive

**Date:** 2026-06-16
**Target:** `https://hudo-2026-j8rip6o92-ian-vincents-projects.vercel.app` (Vercel Preview = staging)
**Supabase:** `hudo-staging` (`egabjtxrrcuzooyclwgw`) · **R2 bucket:** `hudo-staging`
**Method:** Real browser drive via Playwright MCP against the live deployed stack. Every prior "pass" was a mocked unit test — this is the first exercise against the live stack.

---

## TL;DR

The **backend is solid** — the R2 key question (the whole reason for this exercise) is **settled green**, and notifications, preferences, seat gates, PDF export, and guest links all work end-to-end against the live stack. But **three core user-facing flows are broken in the browser** despite passing mocked tests: **both dashboards (agent `/dashboard` and talent `/talent`) fail to list videos**, **video playback is blocked by CSP**, and the **comment UI is never mounted on the video page**. All three are one-to-few-line fixes; root cause and a verified fix are given for each.

The deciding fact: **the R2 access key reaches `hudo-staging`** — the upload PUT returned `200 OK` to `hudo-staging.…r2.cloudflarestorage.com`. No staging-scoped-key follow-up needed.

---

## Results per feature

| #   | Feature                              | Verdict                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Disable Vercel Deployment Protection | ✅ PASS                      | API PATCH `ssoProtection:null`; `/auth/signin` → `200`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1   | Auth + app shell                     | ✅ PASS                      | Owner signs in → `/videos`; header shows nav + NotificationBell; seeded reel listed                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2   | **Agent + talent dashboards**        | ❌ **FAIL (P1)**             | `/dashboard` "No videos found"; `/talent` "Unable to load" — same ambiguous PostgREST embed; reproduces under service-role                                                                                                                                                                                                                                                                                                                                                                  |
| 3a  | **Upload → R2 key scope**            | ✅ **PASS (crown jewel)**    | PUT `200 OK` → `hudo-staging.…r2.cloudflarestorage.com`; presign + complete `200`                                                                                                                                                                                                                                                                                                                                                                                                           |
| 3b  | **Video playback**                   | ✅ **FIXED (live-verified)** | R2 allowlisted in `media-src` (`fix/playback-media-src-csp`, PR #97). Live-verified on the branch preview: authed `/videos/55c07ab0…` **and** guest `/guest/…` both play the signed R2 URL (`readyState 4`, `currentTime` advances, no `error`); console clean of `media-src` violations (only the benign `vercel.live` block). NB: the **seed** video `7cb31754…` still won't play — its R2 object is missing (`403 NoSuchKey`), a seed-data gap, not a CSP/code issue (see finding below) |
| 4a  | **Comment UI on video page**         | ❌ **FAIL (P1)**             | No comment thread/input rendered; components exist but unmounted                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4b  | Comment → notification (backend)     | ✅ PASS                      | POST comment `201` → notification row inserted for talent                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 4c  | Cross-user notification delivery     | ✅ PASS                      | Talent bell shows "1 unread" on load                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4d  | Realtime live push                   | ✅ PASS                      | Server-side insert → badge `1 → 2` live, **no reload**; `useNotifications.ts` uses `postgres_changes` channel (no polling)                                                                                                                                                                                                                                                                                                                                                                  |
| 4e  | Mark read clears count               | ✅ PASS                      | "Mark all read" → badge clears                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4f  | `GET /api/notifications` scoping     | ✅ PASS                      | 200; all rows `recipient_id = talent` only                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5   | Notification preferences persist     | ✅ PASS                      | Email toggle + batch window 15→60; survives reload; 3× PATCH `200`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 6   | Seat gate (Freemium)                 | ✅ PASS                      | 6th agent → `402 {plan_limit_exceeded, limit:5, current:5}`; talent under cap → `201`                                                                                                                                                                                                                                                                                                                                                                                                       |
| 7   | PDF export                           | ✅ PASS                      | `200`, `application/pdf`, `%PDF-`, 1377 bytes                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 8   | Guest link                           | ✅ PASS                      | Generated `201`; opened with **zero auth** → read-only page, 3 comments, no input                                                                                                                                                                                                                                                                                                                                                                                                           |
| 9   | Regression / console                 | ⚠️ NOTE                      | No unexpected JS errors; CSP-blocked PostHog (analytics dead) + minor sign-out 405                                                                                                                                                                                                                                                                                                                                                                                                          |

---

## The crown jewel — R2 key scope: ✅ PASS

The one real unknown is settled. Uploading a real 42 KB mp4 via the UI:

```
POST /api/videos/upload/presign                                  → 200
PUT  hudo-staging.<acct>.r2.cloudflarestorage.com/
       3e44aa4d-…/55c07ab0-…/d6b735f2-….mp4                      → 200 OK   ← key reaches hudo-staging
POST /api/videos/upload/complete                                 → 200
```

The PUT host bucket is **`hudo-staging`**, not `hudo-dev`. The R2 credentials in Preview are correctly staging-scoped. **No follow-up needed.** (Object key layout: `{agencyId}/{videoId}/{versionId}.mp4`.)

---

## Bugs found (with verified fixes)

### 🔴 P1 — Ambiguous `video_versions` embed breaks BOTH dashboards (a class, not one page)

**Symptom:** `/dashboard` (agent/owner) shows "No videos found"; `/talent` (talent's main page) shows "Unable to load videos right now." Every agency-video listing that uses the embed is broken — **only `/videos`** (which uses a different query) works.
**Root cause:** there are now **two** FK relationships between `videos` and `video_versions` (`video_versions.video_id → videos.id` _and_ `videos.active_version_id → video_versions.id`). Any PostgREST embed of `video_versions ( … )` without an FK hint is ambiguous and errors:

> `Could not embed because more than one relationship was found for 'videos' and 'video_versions'`

Two sites carry the unhinted embed:

- `lib/dashboard.ts:100` — `video_versions ( version_number, created_at )` → agent/owner dashboard. The page (`app/(dashboard)/dashboard/page.tsx`) **ignores the error** and renders empty `data` → _silent_ failure.
- `lib/talent-dashboard.ts:89` — `video_versions ( id, version_number )` → talent dashboard. Surfaces the error string.

Reproduces under **both** service-role and owner — not an RLS issue. Mocked unit tests never hit real PostgREST, so this was invisible until now.

**Fix (the dashboard one verified live):** disambiguate the embed at **both** sites:

```diff
- video_versions ( version_number, created_at )      // lib/dashboard.ts:100
+ video_versions!video_versions_video_id_fkey ( version_number, created_at )
- video_versions ( id, version_number )              // lib/talent-dashboard.ts:89
+ video_versions!video_versions_video_id_fkey ( id, version_number )
```

Confirmed against staging: with the hint, `lib/dashboard.ts`'s query returns the seeded reel (talent "Tara Talent", v1). The talent fix is the identical pattern. _(Secondary: make `app/(dashboard)/dashboard/page.tsx` surface the `error` instead of silently rendering `[]`, so the next regression isn't invisible.)_

### ✅ RESOLVED & LIVE-VERIFIED (2026-06-16) — Video playback blocked by CSP

**Fix (PR #97, `fix/playback-media-src-csp`):** option (a) below — allowlisted `https://*.r2.cloudflarestorage.com` in `media-src`. Option (b) (proxy/stream-through-app) was explicitly rejected: it adds egress + HTTP-Range complexity and routes video through Vercel; the short-lived signed-URL design is the de-facto architecture already in code and tests. A regression test (`next.config.test.ts`) locks the R2 host into both `media-src` and `connect-src`. Security review: PASS/LOW (scope identical to existing `connect-src` trust).

**Live verification (branch preview, owner `olivia owner`):** drove the preview with Playwright.

- **Authed `/videos/55c07ab0…`** (a real uploaded mp4): `<video>` reaches `readyState 4`, `error: null`, `duration 3s`, `currentTime` advances past 0, `paused: false` — **it plays**. Console clean of `media-src` violations (only the benign `vercel.live/feedback.js` script-src block remains). Comment thread + posting still work (posted a comment, rendered in-thread at 0:03) — no regression from PR #95.
- **Guest `/guest/<token>`** (generated via Share → `+ Generate link`): guest `<video>` also plays (`readyState 4`, `currentTime` advances, no error); console clean. Confirms the single global CSP covers the guest player too. (Test guest link revoked afterward.)

This rules out the "second blocker behind the CSP error" risk. The fix is the minimum necessary correction and is confirmed working end-to-end.

**⚠️ Separate finding — seed video `7cb31754…` has a missing R2 object (not a CSP/code bug).** The seeded "Staging Test Reel" (`r2_key seed/staging/7cb31754…/v1.mp4`) returns `403 NoSuchKey` — the DB row exists but the file was never uploaded to the bucket, so its `<video>` shows a format error (it receives an XML error body, not mp4). This is a **staging seed-data gap**, independent of PR #97. Fix: re-run the seed upload (or point the seed row at an existing object). The CSP fix is correct regardless — the browser now successfully _issues_ the R2 GET (previously CSP-blocked before any request); the only reason this one fails is the object isn't there.

**Symptom:** Player shows `00:00 / 00:00`; console: media load blocked.
**Root cause:** `/api/videos/:id/playback-url` returns a **direct presigned R2 URL** (`{url, expiresIn:900}`) that the `<video>` loads directly, but `next.config.js` CSP sets `media-src 'self' blob:` — which does **not** include the R2 host. (`connect-src` _does_ list `*.r2.cloudflarestorage.com`, which is why the upload PUT works but playback doesn't.)

> `Loading media from 'https://hudo-staging.…r2.cloudflarestorage.com/…mp4' violates … "media-src 'self' blob:"`

**Fix — pick one (decision needed, touches a documented architecture rule):**

- **(a) Minimal — allowlist R2 in `media-src`** (mirrors `connect-src`; keeps "video never touches Vercel"):
  ```diff
  -  "media-src 'self' blob:",
  +  "media-src 'self' blob: https://*.r2.cloudflarestorage.com",
  ```
- **(b) Architecture-faithful — stream bytes through the app** and keep `media-src 'self' blob:`. This matches CLAUDE.md's "Playback via signing proxy only / Direct R2 URL never returned to any client," which the current direct-URL approach already contradicts.

⚠️ This is the one finding I did **not** auto-resolve a fix for, because it implicates the documented critical architecture rule — your call on (a) vs (b).

### 🔴 P1 — Comment UI never mounted on the video page

**Symptom:** The video detail page (`/videos/[id]`) shows only the player + version selector — **no comment thread and no comment input** (DOM has zero `<textarea>` and no "comment" text). The product's core "timestamped comments" loop is unreachable in the browser.
**Root cause:** `app/(dashboard)/videos/[id]/page.tsx` passes only `player` to `MobilePlayerLayout`, which has unused `panel` and `input` slots. `CommentPanel/CommentInput/CommentThread/CommentItem` exist in `components/comments/` but are **imported by no file under `app/`**.
**Fix:** wire the comment components into the video page via the layout's `panel`/`input` slots (the components are built and the API works — this is integration, not new code). _Telling detail:_ the **guest** page renders comments fine — only the authed video page is missing them.

### 🟡 P3 — PostHog analytics dead under production CSP

PostHog scripts (`config.js`, `surveys.js`) are blocked by `script-src` in Preview/Prod (PostHog is only allowed under `isDev`). Consent is honoured (scripts don't load pre-consent), but they **also never load post-consent**, so analytics is non-functional on staging/prod. Allow `https://*.i.posthog.com` in `script-src` for non-dev if analytics is wanted.

### ⚪ Minor — sign-out lands on a transient error page

Clicking "Sign out" briefly hits `chrome-error://chromewebdata/` with a `405` before redirect. Did not block re-auth. Worth a glance at the sign-out POST/redirect handling.

---

## Console / network errors (regression sweep)

No unexpected JavaScript errors across the whole walk. Recurring console errors, all explained:

- `vercel.live/feedback.js` blocked by CSP — **benign** (the app's strict CSP correctly rejecting Vercel's preview injection).
- `favicon.ico` 404 — trivial.
- PostHog scripts blocked — finding P3 above.
- R2 media blocked — finding P1 (playback) above.
- `402` on `/api/agencies/.../members` — **expected** (the seat-gate test).

---

## Setup performed (for reproducibility)

- **Deployment Protection:** disabled via Vercel API (`PATCH …/v9/projects/{id}` `{ssoProtection:null}`). This makes all preview URLs public and enables real guest links. **Re-enable before any public exposure.**
- **Seed:** `scripts/seed-staging.mjs` → agency `hudo-staging-test`, users `owner@/agent@/talent@hudo.test` (pw `HudoStaging2026!`), seeded reel + 2 comments.
- **Seat-gate fixtures:** 3 filler agents added (agency at 5/5 agent cap), plus spare `gate-agent6@` (used for the 402) and `gate-talent@` (added as talent during the test). These remain as test data.
- **Cleanup done:** `/tmp/stg.env` and temp scripts deleted. No secrets printed.

## Follow-ups (priority order)

1. **Fix the ambiguous embed at both sites** (`lib/dashboard.ts:100` + `lib/talent-dashboard.ts:89`; dashboard fix verified live).
2. **Decide playback approach** (CSP allowlist vs proxy) and apply.
3. **Wire comment UI** into the video page.
4. Re-enable Deployment Protection if staging should not stay public.
5. (Optional) PostHog CSP allowlist; sign-out redirect glitch.
6. Note: these were invisible because the suite is fully mocked — consider a thin live smoke test (dashboard query, playback URL, comment render) in CI against a preview.
