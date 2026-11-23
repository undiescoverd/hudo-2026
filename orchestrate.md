# orchestrate.js — Hudo Build Orchestrator

A single plain Node.js script (no dependencies) that manages the Claude Code agent build process: parsing sprint task files, resolving the dependency graph, generating agent prompts, and tracking progress.

**Requirements:** Node.js 20+. No install step.

---

## Quick Start

```bash
node orchestrate.js status          # See all sprints and task statuses
node orchestrate.js next            # See what to work on right now
node orchestrate.js prompt S0-INFRA-001  # Get a Claude Code prompt for a task
```

---

## Commands

### `status`
Prints the full dependency graph and progress bar for every sprint.

```
node orchestrate.js status
```

Example output:
```
=== Hudo Orchestration Status ===

sprint-0 [████░░░░░░] 4/11 tasks done
  S0-INFRA-001         done         claude-haiku-4.5      Initialise repository and Next.js project
  S0-INFRA-002         done         claude-haiku-4.5      Configure GitHub Actions CI
  S0-INFRA-003         in_review    claude-haiku-4.5      Configure Vercel deployment
  S0-INFRA-004         not_started  claude-sonnet-4.6     Configure security headers
  ...
```

Colours: green = done, yellow = in_progress/in_review, red = blocked, white = not_started.
Model colours: blue = haiku-4.5, yellow = sonnet-4.6, red = opus-4.6.

---

### `next`
Prints all currently unblocked tasks (STATUS is `not_started` and all BLOCKED_BY tasks are `done`), grouped into parallelism waves.

```
node orchestrate.js next
```

Example output:
```
=== Unblocked Tasks (Parallelism Waves) ===

Wave 1 (run simultaneously)
  S0-INFRA-002         claude-haiku-4.5  Configure GitHub Actions CI
    Branch: feat/s0-infra-002-ci
  S0-INFRA-003         claude-haiku-4.5  Configure Vercel deployment
    Branch: feat/s0-infra-003-vercel
  S0-DB-001            claude-haiku-4.5  Provision Supabase environments
    Branch: feat/s0-db-001-supabase-envs

Wave 2 (after Wave 1 completes)
  S0-DB-002            claude-sonnet-4.6  Write initial schema migration
    Branch: feat/s0-db-002-schema
```

Tasks within a wave can be run simultaneously in parallel agent sessions. Tasks in Wave 2 must wait for all Wave 1 tasks to be `done`.

---

### `prompt <TASK_ID>`
Generates a complete, ready-to-paste Claude Code agent prompt for the given task. The MODEL is displayed at the top — select it in Cursor before starting the session.

```
node orchestrate.js prompt S0-DB-002
```

Example output:
```
═══════════════════════════════════════════════════════
  MODEL: claude-sonnet-4.6
  ⚠  Select this model in Cursor before starting this session
═══════════════════════════════════════════════════════

You are a build agent for the Hudo project.

Your task is below. Read it fully before writing any code.

TASK_ID: S0-DB-002
...
```

Copy the entire output and paste it into a new Claude Code / Cursor session.

---

### `start <TASK_ID>`
Sets STATUS to `in_progress` in the sprint file. Run this before writing any code.

```
node orchestrate.js start S0-DB-002
```

---

### `review <TASK_ID>`
Sets STATUS to `in_review`. Run this when opening the PR.

```
node orchestrate.js review S0-DB-002
```

---

### `done <TASK_ID>`
Sets STATUS to `done` and immediately prints any tasks that are now unblocked.

```
node orchestrate.js done S0-DB-002
```

Example output:
```
✓  S0-DB-002 done

Newly unblocked:
  S0-DB-003  claude-sonnet-4.6  Create RLS test suite
```

---

### `gate <sprint-name>`
Prints the sprint gate checklist with each item marked ✓ or ✗ based on the checkboxes in the sprint file.

```
node orchestrate.js gate sprint-0
```

Example output:
```
=== Gate Checklist: sprint-0 ===

  ✓  pnpm dev runs locally without errors
  ✓  pnpm lint and pnpm type-check pass
  ✗  CI passes on an empty PR
  ✗  Vercel preview deploys on PR open
  ...

⚠  Sprint not fully done — gate not yet passable
```

Update gate checklist items in `tasks/sprint-0.md` by changing `- [ ]` to `- [x]` manually as you verify each criterion.

---

### `blocked <TASK_ID> "reason"`
Marks a task as blocked, records the reason in `orchestrate-audit.log`.

```
node orchestrate.js blocked S0-STORAGE-001 "Cloudflare account access not yet granted"
```

Always quote the reason. The audit log entry includes a timestamp. Also syncs the `Blocked` state to Linear.

---

### `sync-check`
Compares markdown task statuses with their Linear counterparts (read-only). Linear is read in one paginated GraphQL query for the whole `Resolvelabs` team (archived issues included), so a run costs a few API requests however many tasks exist. Issues are matched to tasks by title prefix (`<TASK_ID>` at the start of the title); `Canceled` / `Duplicate` issues and `[dup of …]` titles are ignored, and if several live issues match the lowest identifier is used and the ambiguity is printed. Requests that hit HTTP 429 or 5xx are retried with exponential backoff (honouring `Retry-After`, max 4 attempts).

```
node orchestrate.js sync-check [--ci]
```

Example output:
```
=== Linear Sync Check ===

  TASK                 MARKDOWN       LINEAR         STATUS
  ────────────────────────────────────────────────────────────
  S0-INFRA-001         done           Done           ✓ in sync
  S0-DB-003            in_review      Todo           ✗ DRIFTED
  S4-NEW-001           not_started    (no issue)     ✗ MISSING

⚠  1 task(s) drifted from Linear.
⚠  1 task(s) have no Linear issue (MISSING).
   Run: node orchestrate.js sync-fix to repair drift
```

Per-task results:

| Result | Meaning |
|---|---|
| `in sync` | Linear state matches the markdown status |
| `DRIFTED` | Linear state contradicts the markdown status |
| `MISSING` | No live Linear issue has this task ID as its title prefix |
| `CANCELED` | The only matching issues are Canceled / Duplicate. They are never created over or updated (no un-cancelling); a warning is printed and the count shown. Does not fail `--ci` |
| `ERROR` | Linear could not be read (API down, bad key, rate limit after retries): every task is reported as `ERROR` |

A `not_started` task counts as drifted only if Linear shows it Done. In Progress and In Review are normal while its feature branch is open: the status bump lives on the branch, and `linear-update.yml` moves Linear on push and PR open. Every other status must match its Linear state exactly.

It also lists tasks that look merged into a release ref (`main`, `production`, `preview/wave-*`) but are not marked done. The branch-ancestor check is the strongest evidence. The fallback only counts a task ID that appears in a commit *subject*, and ignores `chore` commits: bodies of plan/spec commits list future task IDs, and chore commits add sprint rows or bump status without building anything.

Several live issues for one ID are counted as "ambiguous" (warning only). `--ci` turns off colour and exits 1 if any task is `DRIFTED`, `MISSING`, `ERROR` or merged-but-not-done; otherwise 0. In GitHub Actions a report is also written to the step summary. Without `--ci` the exit code is always 0.

---

### `sync-fix`
Repairs everything `sync-check` reports, then re-checks Linear:

- **DRIFTED**: pushes the markdown status to Linear (a drifted `not_started` task is moved back to Backlog). Markdown stays the source of truth.
- **MISSING**: creates (at most 10 per run; more are refused and listed unless `--create-all` is passed, and `--ci` then fails) the Linear issue in team `Resolvelabs`, titled `<TASK_ID> — <TITLE>`, with a short description (source `tasks/sprint-N.md`, created by sync-fix) and the state mapped from the markdown status (`not_started` becomes Backlog). The project is the one most used by existing issues with the same `S<N>-` prefix; if none has a project the issue is created without one and the output says so. Each created identifier is printed.
- **Merged into a release ref but not done**: the task is flipped to `done` in markdown, then Linear is set to Done.

`issueCreate` is never retried after a 5xx, timeout or network error (the outcome is unknown, and a retry could duplicate); only 429 is retried. The re-check, or the next run, reconciles by title. A task with merge evidence is never pushed back from Done. In CI the markdown flip is not committed, so the daily job keeps Linear correct and posts the merged-but-not-done task IDs to Slack for a human to mark done on `main`. The workflow runs under a `linear-sync` concurrency group so two runs cannot overlap.

Updates go straight to the issue by id (`issueUpdate`), so no per-task search is needed. Idempotent: safe to run repeatedly.

```
node orchestrate.js sync-fix [--ci]
```

`--ci` turns off colour and exits 1 if, after the fixes and the re-check, any task is still `DRIFTED`, `MISSING` or `ERROR` (for example the API is unreachable), or any fix failed.

Logs results to `orchestrate-audit.log`: `SYNC-FIX: N fixed, N failed` (and `SYNC-FIX-CREATE` per created issue).

---

## Self-Healing Architecture

Linear sync is automated at multiple levels to prevent drift:

| Trigger | What happens |
|---|---|
| `orchestrate.js start/review/done/blocked` | Syncs to Linear immediately (with 1 retry; the helper script also backs off on HTTP 429/5xx) |
| Push to `feat/s*-*` branch | GitHub Actions marks Linear → In Progress (only from Backlog/Todo). The task ID is found case-insensitively anywhere in the branch name (`feat/s5-S5-FLOW-003-x` → `S5-FLOW-003`) |
| PR opened | GitHub Actions marks Linear → In Review + patches PR description |
| PR merged | GitHub Actions marks Linear → Done |
| Daily cron (08:00 UTC) | `linear-sync-check.yml` runs `sync-check --ci`, then `sync-fix --ci` if it failed. The job fails (and Slack says so) if anything is still drifted, missing or unreachable afterwards |
| Manual check | `node orchestrate.js sync-check` / `sync-fix` |

If `syncLinear()` fails, the warning message directs you to run `sync-fix` to repair.

---

## Task Block Format

Every task in a sprint file must follow this exact format. The parser is strict about field names and indentation.

```
- [ ] **[TASK_ID]** — [TITLE]

TASK_ID: S0-INFRA-001
TITLE: Initialise repository and Next.js project
BRANCH: feat/s0-infra-001-repo-init
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - Criterion one
  - Criterion two
FILES:
  - path/to/file.ts
  - path/to/other.ts
NOTES: Any notes for the agent
```

**Valid MODEL values:** `haiku-4.5`, `sonnet-4.6`, `opus-4.6`

**Valid STATUS values:** `not_started`, `in_progress`, `in_review`, `done`, `blocked`

**BLOCKED_BY:** Either `none`, or a comma-separated list of TASK_IDs (e.g. `S0-DB-001, S0-STORAGE-001`).

Task blocks are separated by `---` lines. The parser detects each block by finding the `TASK_ID:` field.

---

## Model Selection Guide

| Model | When to use |
|---|---|
| `haiku-4.5` | Mechanical tasks: repo setup, CI config, environment provisioning, file scaffolding. Fast and cheap. |
| `sonnet-4.6` | Most feature code: API routes, database logic, RLS policies, business logic, integrations. |
| `opus-4.6` | Complex architectural decisions, security-critical code, tasks with many interacting constraints. Use sparingly. |

The `prompt` command displays the model in colour at the top. Select it in Cursor's model selector before starting the session — the wrong model wastes time and money.

---

## Workflow Walkthrough

**1. See what's ready**
```bash
node orchestrate.js next
```

**2. Pick a task from Wave 1**
```bash
node orchestrate.js prompt S0-INFRA-002
```

**3. Open a new Cursor session, select the specified model, paste the prompt**

**4. Agent runs the start command before writing code**
```bash
node orchestrate.js start S0-INFRA-002
```

**5. Agent writes code, commits, pushes branch**

**6. Agent runs the review command when opening PR**
```bash
node orchestrate.js review S0-INFRA-002
```

The `linear-update.yml` workflow fires automatically on push (marks In Progress if the Linear issue is in Backlog/Todo) and on PR open (marks In Review and patches the PR description with `Resolves HUD-XX` so Linear attaches the PR to the issue card).

**7. Code review agent reviews the PR. Human approves.**

**8. Merge PR. Mark task done.**
```bash
node orchestrate.js done S0-INFRA-002
```

**9. Check for newly unblocked tasks, repeat from step 1.**

**10. When all sprint tasks are done, verify the gate.**
```bash
node orchestrate.js gate sprint-0
```

---

## Files

| File | Purpose |
|---|---|
| `orchestrate.js` | The orchestrator script |
| `orchestrate.md` | This documentation |
| `orchestrate-audit.log` | Append-only log of start/done/blocked events with timestamps |
| `tasks/sprint-0.md` | Sprint 0 task list |
| `tasks/sprint-N.md` | Future sprint task lists (added as sprints are planned) |
| `scripts/update-linear-task.sh` | Local helper — update or query (`--status`) Linear task status from the CLI |
| `.github/workflows/linear-update.yml` | GitHub Actions — marks In Progress on push, In Review on PR open (patches PR description), Done on merge |
| `.github/workflows/linear-sync-check.yml` | Daily cron — `sync-check --ci` / `sync-fix --ci`, fails loudly if drift remains, notifies Slack |

The audit log is created automatically on first use. Do not delete it — it provides a record of who started and completed what.

---

## Notes

- File writes are atomic (write-to-temp, rename) — the script will never corrupt a task file even if interrupted.
- Circular dependencies are detected at load time and produce a clear error with the full cycle printed.
- Tasks with no BLOCKED_BY (or `BLOCKED_BY: none`) are immediately unblocked.
- If a task has no MODEL field, the script defaults to `sonnet-4.6` and prints a warning. Add the field.
- The script does not execute any code in the repo — it only reads and writes task markdown files.
