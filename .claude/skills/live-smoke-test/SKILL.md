---
name: live-smoke-test
description: Drive a thin live walkthrough of a Preview branch deployment with Playwright MCP — sign-in, dashboard query, video playback (readyState 4), comment thread render — to catch the live-breakage class that the fully-mocked unit suite passes green. Run after deploying a branch that touches dashboards, playback, comments, RLS embeds, or CSP.
disable-model-invocation: true
---

Run a thin live smoke test against a **Preview branch URL**. CLAUDE.md's Failure Log records
that a fully-mocked unit suite passed green while 3 live P1s shipped (both dashboards,
playback, comment UI). This walkthrough is the cheap check that catches that class.

## Critical: target the Preview branch URL, NOT the prod-target domain

- Use the **Preview branch URL**: `…-git-<branch>-…vercel.app`.
- **Do NOT** use the production-target domain (`hudo-2026-…vercel.app`) — it points at a
  *different* Supabase than staging, so seed users 401 there (MEMORY.md gotcha).
- If you don't have the branch URL, get it from the latest Vercel preview deployment for the
  branch before starting.

## Steps (Playwright MCP)

1. **Sign in** as a seed user (email/password). Confirm you land on an authed page, not the
   login screen.
2. **Dashboard query renders.** Navigate to `/dashboard` (and `/talent` if relevant) and
   confirm video rows render — NOT an empty state or "Unable to load". The ambiguous-FK break
   showed as silent-empty `/dashboard` and "Unable to load" on `/talent`.
3. **Playback works.** Open the crown-jewel video `55c07ab0-90fc-4764-995c-03ab6a14754d`.
   Evaluate the `<video>` element and confirm:
   - `readyState === 4`
   - `error === null`
   - `currentTime` advances after play (poll twice).
4. **Comment thread renders.** Confirm the authed video page mounts the comment thread + input
   (not just the player). The guest page (`/guest/<token>`) renders comments separately —
   check it too if guest links are in scope.
5. **Console is clean of `media-src` CSP violations.** Read Playwright console messages and
   confirm no `Content-Security-Policy` / `media-src` errors — a `media-src` violation means
   R2 playback is blocked even though the URL signs fine.

## Report

For each step: pass/fail with the concrete evidence (`readyState`, `currentTime` delta, row
count, console state). A green mocked suite is not evidence — only the live observations are.
