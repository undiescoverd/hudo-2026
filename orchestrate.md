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

Always quote the reason. The audit log entry includes a timestamp.

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

The `linear-update.yml` workflow fires automatically on PR open: it marks the Linear issue In Review and patches the PR description with `Resolves HUD-XX` so Linear attaches the PR to the issue card.

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
| `scripts/linear-id-map.json` | Maps TASK_IDs (e.g. S0-INFRA-001) to Linear UUIDs |
| `scripts/update-linear-task.sh` | Local helper — update Linear task status from the CLI |
| `.github/workflows/linear-update.yml` | GitHub Actions — marks In Review on PR open (and patches PR description with `Resolves HUD-XX`), marks Done on merge |

The audit log is created automatically on first use. Do not delete it — it provides a record of who started and completed what.

---

## Notes

- File writes are atomic (write-to-temp, rename) — the script will never corrupt a task file even if interrupted.
- Circular dependencies are detected at load time and produce a clear error with the full cycle printed.
- Tasks with no BLOCKED_BY (or `BLOCKED_BY: none`) are immediately unblocked.
- If a task has no MODEL field, the script defaults to `sonnet-4.6` and prints a warning. Add the field.
- The script does not execute any code in the repo — it only reads and writes task markdown files.
