# Contributing to Hudo

## Branching Convention

All feature work is done on branches following this pattern:

```
feat/<task-id>-<short-description>
```

Examples:

- `feat/s0-infra-001-repo-init`
- `feat/s1-upload-001-presigned-url`

Branch names come from the `BRANCH` field in each task definition (`tasks/sprint-N.md`).

## Git Worktree Workflow

Use git worktrees to work on multiple tasks simultaneously without switching branches in your main checkout.

### Initial setup

Clone the repo once as bare:

```bash
git clone --bare <repo-url> hudo.git
cd hudo.git
```

### Starting a task

Create a worktree for the task branch:

```bash
git worktree add ../hudo-<task-id> -b feat/<task-id>-<description>
cd ../hudo-<task-id>
pnpm install
cp .env.example .env.local  # fill in values
```

### Working in a worktree

Each worktree has its own working directory and index but shares the `.git` object store.

```bash
# In the worktree directory
pnpm dev          # runs on a different port automatically (use PORT=3001 pnpm dev if needed)
git add <files>
git commit -m "feat(s0-infra-001): initialise Next.js project"
git push -u origin feat/<task-id>-<description>
```

### Opening a PR

After pushing, open a PR from the branch to `main` on GitHub, then update the orchestrator:

```bash
node /path/to/hudo.git/orchestrate.js review <TASK_ID>
```

### Cleaning up

After a PR is merged:

```bash
cd ..
git worktree remove hudo-<task-id>
git -C hudo.git branch -d feat/<task-id>-<description>
```

### Listing active worktrees

```bash
git worktree list
```

## Commit Style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>
```

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`

Scope is the task ID or area: `s0-infra-001`, `auth`, `rls`, `storage`.

Examples:

```
feat(s0-infra-001): initialise Next.js 14 with App Router
chore(s0-infra-001): add ESLint and Prettier configuration
test(s0-db-003): add RLS policy test for videos table
```

## Pull Request Requirements

- All CI checks must pass: lint, type-check, unit tests, RLS tests
- Branch protection requires at least one approved review before merge
- Do not merge your own PR without a review (except during initial infrastructure setup)

## Orchestrator Commands

```bash
node orchestrate.js start <TASK_ID>   # mark task in_progress
node orchestrate.js review <TASK_ID>  # mark task in_review (on PR open)
node orchestrate.js done <TASK_ID>    # mark task done (on PR merge)
```
