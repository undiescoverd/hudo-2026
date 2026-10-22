# Flow inventory

Single checklist of every user flow in Hudo. Each flow is ticked off in four stages. A flow is done only when all four are ticked.

**Source of truth:** the Paper file "Hudo App" (team Ian's Team), flow pages "Flow · …". Paper holds the design. This file holds status. If the two disagree, Paper is right about intent and this file needs updating.

## How to tick

- **Before starting work** on anything that touches a flow, find its row here and read its Paper board.
- **In the same PR** that changes a flow, update its row: set Designed, Specced, Built or Verified as they change.
- **Values**
  - Designed: `Drawn` (screens on the board), `Mapped` (flow on a board, screens missing), `Partial`, `Not drawn`, `Conflict` (plan and Paper disagree), `n/a`
  - Specced: GitHub issue number(s), or `—`
  - Built: `Yes`, `Partial`, `No` (checked against code, not memory)
  - Verified: `Unit`, `Live`, `Not checked`
- **New flow?** Draw it in Paper first, add a row, then build.

## Paper flow pages

| Paper page | Artboard IDs (main / edge cases) | Covers |
|---|---|---|
| Flow · Coverage map | 3B2-0 | The F0–F27 audit below, against code and Paper |
| Flow · Core review loop (Flow 01) | 2OY-0 / 2VH-0 | Upload, triage, comments, status, versions |
| Flow · Guest review link (Flow 02) | 31W-0 / 36W-0 | Guest link creation, guest player |
| Flow · Invite and join (Flow 03) | 3KU-0 / 3PD-0 | Agent and talent invites, accept, first run |
| Flow · Sign in and recover (Flow 04) | 3W8-0 / 41T-0 | Sign in, session, sign out, password reset |
| Flow · Owner sign-up and verify (Flow 05) | 49E-0 / 4EZ-0 | Agency owner sign-up wizard, email verification |
| Flow · Review loop as built (Flow 06) | 4LS-0 / 4PX-0 | What the code does today, from upload to new version |

Component pages (Foundations, Primitives, Shell & Notifications, Dashboard, Player & Versions, Comments, Upload, Guest, Billing & Settings) are not flows. Flows reuse them, so the flow boards are the reference for what the user does.

## Flow checklist

The 28 rows are the F-numbers from the Paper coverage map. The three "extra" rows are in Paper but not on the coverage map.

Paper step numbers below are approximate, read from the boards. Check the board before relying on one.

| ID | Flow | Paper board / steps | Designed | Specced | Built | Verified |
|---|---|---|---|---|---|---|
| F0 | Foundation fixes (route protection, media tables) | none (code only) | n/a | — | No | Not checked |
| F1 | Log in, log out, stay signed in | Flow 04, steps 01–09 | Mapped | — | Partial | Not checked |
| F2 | Forgot and reset password | Flow 04, steps 10–16 | Mapped | — | Yes (race and session bugs) | Not checked |
| F3 | Email verification | Flow 05, steps 09–13, 18 | Partial | — | No | Not checked |
| F4 | Agency owner sign-up | Flow 05, steps 01–08, 14–16 | Partial | — | Partial (wrong flow wired) | Not checked |
| F5 | Invite and onboard an agent | Flow 03, sender and accept steps | Mapped | — | Partial | Not checked |
| F6 | Invite and onboard a talent | Flow 03, invitee and accept steps | Mapped | — | Partial (accept returns 400 for existing talent) | Not checked |
| F7 | First-run onboarding | Flow 03, steps 12–13; Flow 05, steps 15–16 | Partial | — | Partial | Not checked |
| F8 | Role dashboards | Flow 01 (dashboards, Needs you strip); Flow 06, step 06 | Partial | — | Partial | Not checked |
| F9 | Talent uploads media | Flow 01, steps 01–04; Flow 06, steps 01–04, 11–12 | Partial | #149, #150, #151, #164 | Partial | Not checked |
| F10 | Needs attention list: seen-by now, owner later | Flow 01 "Needs attention" strip (renamed in Paper 2026-10-22) | Decided | #176 (spec, not yet confirmed ready) | No | Not checked |
| F11 | Agent reviews with voice feedback | Flow 01, steps 05–07 (typed comments only) | Conflict | #169 | Partial (typed comments work; no voice recording code found) | Not checked |
| F12 | Complete review and export edit list | Flow 01, steps 09–11; Flow 06, steps 09–10 | Conflict | #159, #160, #161 | Partial (PDF is HTML, no export) | Not checked |
| F13 | Talent receives and views feedback | Flow 01, steps 06–07 | Partial | #168, #163 | Partial | Not checked |
| F14 | Notifications | Flow 01, step 08; Flow 02, step 08 | Partial | #170 | Partial | Not checked |
| F15 | Media library and talent portfolio | Video table and card on Dashboard page only | Partial | — | No | Not checked |
| F16 | Profile and account settings | not drawn | Not drawn | — | Partial (API only) | Not checked |
| F17 | Agency settings | Legal entity form only (Billing & Settings page) | Partial | — | Partial (API only) | Not checked |
| F18 | Team management | not drawn | Not drawn | — | Partial (invites only) | Not checked |
| F19 | Talent roster | not drawn | Not drawn | — | No | Not checked |
| F20 | Talent responds to feedback | Flow 01 comment thread and upload v2 | Partial | — | No | Not checked |
| F21 | Talent transfer between agencies | not drawn | Not drawn | — | No | Not checked |
| F22 | Search, filters and activity history | Status filter only | Partial | — | No | Not checked |
| F23 | Platform admin | not drawn | Not drawn | — | Partial (pages broken) | Not checked |
| F24 | Billing and subscriptions | Billing overview page | Partial | #142 (pricing draft) | Yes (S3 billing shipped, see discrepancies) | Not checked |
| F25 | Account deletion and data export | not drawn | Not drawn | #143, #144–#149 | Partial (erasure shipped, deletion not) | Not checked |
| F26 | Google and Apple sign-in | not drawn | Not drawn | — | Partial (disabled placeholder buttons) | Not checked |
| F27 | System pages: errors, empty states, legal | Flow 05 step 15; Flow 03 step 13; Flow 02 invalid-link | Partial | #171 | Partial | Not checked |
| G1 | Guest review link (extra) | Flow 02, all steps and edge cases | Drawn | #165, #166, #167, #170 | Yes | Not checked |
| G2 | Versions and status pipeline (extra) | Flow 01, steps 03–04, 09–10; Flow 06 | Drawn | #159, #160, #161, #162 | Partial | Not checked |
| G3 | Legal entity, DPA and cookie consent (extra) | Billing & Settings page; Flow 05, step 06 | Partial | — | Yes (BILLING-004, BILLING-006, COMPLY-003) | Not checked |

## Decisions

- **2026-10-22, review model (F10):** agents see a shared "Needs attention" list, with no claim or assignment for now. Each video shows who has seen it ("seen by"). Anyone in the agency can comment, so outside input is always open. Ownership (`owner_id`, claim and assign) is deferred until an agency asks for it. Reasons: it needs atomic claims and realtime ownership changes, and "seen by" reuses the `comment_reads` work already tracked in #168.
- **2026-10-22, list name:** "Needs attention" (replaces "Needs you" on the Flow 01 and Flow 06 boards).
- **2026-10-22, talent visibility:** talent do not see "seen by" for now.
- **Open:** Ian is not yet sure the spec in #176 is ready to build. Blocked until he says what is unclear.

## Gaps on the boards with no issue yet

These came from reading the boards. The list is not exhaustive.

- **Flow 06, step 11:** a talent cannot resubmit after changes are requested, so the video stays stuck. No issue.
- **Flow 06, step 09:** comments cannot be resolved, edited, deleted or replied to from the UI. Partly covered by F20.
- **Flow 04:** no account lockout after failed sign-ins (auth routes are rate-limited, so the board's "no lockout or rate limit" is only half right); owners hit a redirect loop; session refresh doesn't retry; the password-changed email is never sent. No issue.
- **Flow 03:** the "invite agent" link goes to a page that doesn't exist; a pending invite can't be listed, resent or revoked; duplicate pending invites are allowed. No issue.
- **Flow 05:** the sign-up wizard isn't wired to a page; email verification is never sent; the welcome email is a TODO. No issue.

## Discrepancies to resolve

- **Paper coverage map is out of date for F1–F7.** It says "Not drawn" for sign-in, verification and invites, but Flows 03–05 are now on the board. The table above uses the boards.
- **F24, F25 and G3 read as not built on the coverage map, but S3 billing and compliance shipped to main** (see `CLAUDE.md` Sprints and the billing memory). The table uses the shipped state. The coverage map needs the same correction.
- **Built checks so far (2026-10-22):** F10 (no review session code), F25 (erasure route exists, no video delete route), F12 (PDF export code exists, output is HTML), F11 (no voice recording code) and G3 (cookie banner and legal entity present) were checked against code. The other Built values are still from the coverage map.
- **F10–F12 are Conflict** because the build plan and Paper describe the review loop differently. This is still the open decision, and it blocks the Phase 2–4 redraws.
- **The original F0–F27 plan document can't be found.** The Paper coverage map is the only place these IDs are defined, so this table takes its IDs from there.
