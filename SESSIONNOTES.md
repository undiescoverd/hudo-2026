# Hudo — Session Notes

Running log of build events, errors, gotchas, and fixes. Append-only; newest entries at the top. Distil recurring gotchas into `CLAUDE.md → Failure Log` once they're stable.

## Format

See CLAUDE.md → "SESSIONNOTES.md log".

---

## 2026-05-10 — Sprint 1 close-out + Sprint 2 kickoff

- **Task:** Archive sprint-1 (17/17 done), seed `tasks/sprint-2.md` with all 13 S2 tasks (Dashboards, Plan Gating, Notifications, Guest Links).
- **Models:** planner=opus, executor=opus (mechanical task-file generation only)
- **Outcome:** done
- **Notes:** Moved `tasks/sprint-1.md` → `tasks/archive/sprint-1.md`. Created `tasks/sprint-2.md` mirroring sprint-1 structure: per-task TASK_ID/BRANCH/MODEL/STATUS/BLOCKED_BY/ACCEPTANCE_CRITERIA/FILES blocks. Sprint Gate copied verbatim from `tasks/sprints-all.md`. Model assignments per CLAUDE.md sizing: M→sonnet (default), S/XS→haiku, L (DASH-001, NOTIF-002)→sonnet with code-review gate flagged in NOTES. Security-sensitive tasks (NOTIF-001, GUEST-001/002/003) flagged for mandatory devsecops-security-engineer review. `node orchestrate.js next` confirms wave 1: DASH-001, DASH-002, DASH-004, GATE-001, NOTIF-001, GUEST-001.
- **Gotcha (if any):** Orchestrator only loads non-archived sprint files, so cross-sprint `BLOCKED_BY: S1-*` / `S0-*` entries surface as "unknown dep" and leave tasks stuck even when those deps are done. Convention: only list intra-sprint deps in `BLOCKED_BY`; record cross-sprint context in `NOTES` instead. Mirrors how `sprint-1.md` handled S0 deps.

---

## 2026-05-10 — Workflow rule + session log bootstrap

- **Task:** Establish Opus-plans / Sonnet-or-Haiku-executes / review-chain workflow rule, create SESSIONNOTES.md, add Stop-hook reminder.
- **Models:** planner=opus, executor=opus (workflow doc + hook only — pure config, no code path)
- **Outcome:** done
- **Notes:** Added `## Model & Workflow Rule` section to CLAUDE.md after Agent Rules. Created this file. Merged a `Stop` hook into `.claude/settings.json` that prints a `systemMessage` if `.ts/.tsx/.sql/.js` files changed but SESSIONNOTES.md was not modified. Existing PreToolUse / PostToolUse hooks left untouched.
- **Gotcha (if any):** Stop hook uses `;` not `&&` between commands — `&&` breaks the chain when `grep` finds no match (exit 1) and the reminder never fires.
