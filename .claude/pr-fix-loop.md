# PR Review Fix Loop Prompt

You are fixing issues flagged by the automated PR review on this branch.

## Each iteration, do exactly this:

### Step 1 — Check the review status

Run:

```bash
gh pr view --json number,headRefName,statusCheckRollup 2>/dev/null
```

If this returns an error (no PR open), output:
<promise>NO PR OPEN</promise>
and stop.

### Step 2 — Wait for any in-progress DeepSeek review

Check if the "PR Review" check is currently running:

```bash
gh pr checks 2>/dev/null | grep "PR Review"
```

If it shows "in_progress" or "queued", wait for it to complete:

```bash
for i in $(seq 1 12); do
  sleep 15
  status=$(gh pr checks 2>/dev/null | grep "PR Review" | awk '{print $2}')
  echo "Check status: $status"
  if [ "$status" != "in_progress" ] && [ "$status" != "queued" ]; then break; fi
done
```

### Step 3 — Get the latest automated review comment

```bash
gh pr view --json comments --jq '
  .comments
  | map(select(.author.login == "github-actions[bot]"))
  | last
  | .body
' 2>/dev/null
```

**If the comment contains "## Approved" or "No issues found":**
Output:
<promise>APPROVED</promise>
and stop.

**If there is no review comment yet:**
Output:
<promise>NO REVIEW YET</promise>
and stop. (Push a trivial commit or wait — the review will trigger on the next push.)

**If the comment contains "## Changes Required":** continue to Step 4.

### Step 4 — Parse and fix each finding

The review lists findings like:

```
1. **[SEVERITY: high]** `path/to/file.ts:42` — Description of issue.
```

For each finding:

- Read the referenced file at the referenced line
- Understand what the issue is
- Apply the minimal fix that resolves it
- Do NOT fix things not listed in the findings
- Do NOT refactor surrounding code

### Step 5 — Verify fixes compile and lint

```bash
pnpm type-check && pnpm lint
```

If either fails, fix the errors before continuing.

### Step 6 — Commit and push

```bash
git add -A
git commit -m "fix: address PR review findings"
git push
```

### Step 7 — Wait for new DeepSeek review to post

Poll until a new comment appears (DeepSeek typically takes 60–90 seconds):

```bash
BEFORE=$(gh pr view --json comments --jq '.comments | map(select(.author.login == "github-actions[bot]")) | length')
for i in $(seq 1 18); do
  sleep 10
  AFTER=$(gh pr view --json comments --jq '.comments | map(select(.author.login == "github-actions[bot]")) | length')
  echo "Waiting for new review... ($i/18) comments: $AFTER"
  if [ "$AFTER" -gt "$BEFORE" ]; then
    echo "New review posted."
    break
  fi
done
```

### Step 8 — Let Ralph re-run

Do not output a promise. Exit normally. Ralph will re-run this prompt and pick up the new review.

---

## Hard rules

- Fix ONLY what is listed in the findings. Nothing extra.
- If a finding is a false positive, add a comment in the code explaining why it is safe, and note it in your commit message.
- Always run `pnpm type-check && pnpm lint` before pushing.
- If you cannot fix a finding (requires architectural change, missing context, etc.), skip it and flag it with a `TODO: PR-REVIEW:` comment in the code.
- Max 10 fix commits per Ralph session. If you reach 10, output: <promise>MANUAL REVIEW NEEDED</promise>
