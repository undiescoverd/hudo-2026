# Gotchas & Lessons Learned

Reference guide for common issues, bugs, and unexpected behaviors encountered during Hudo development. **Check here before debugging similar symptoms.**

## Logging Standard

When documenting new gotchas:
- **Symptom** (1 line): What the developer observes/error message
- **Root cause** (1-2 lines): Why it happens
- **Fix** (1-3 lines + code if needed): How to solve it immediately
- **Prevention** (1 line): One thing to remember to avoid it next time

**Total: ~6-8 lines max per issue.** No lengthy explanations. Link to external docs if deep context is needed.

---

## Build & CI

### `vercel link --yes` Overwrites `.env.local`

**Symptom**: After running `vercel link --yes`, missing env vars; local dev breaks.

**Root cause**: Vercel CLI overwrites `.env.local` with the project's Development environment variables (which are empty in Resolve Labs setup).

**Fix**: Restore `.env.local` from backup or copy from `.env.staging`:
```bash
cp .env.staging .env.local
# Then manually add dev-specific overrides if needed
```

**Prevention**: Use `vercel link` (interactive) instead of `vercel link --yes`, or don't run `vercel link` after initial setup.

---

## Environment Variables

### Sentry Auth Token Contains `=` Sign

**Symptom**: When adding `SENTRY_AUTH_TOKEN` to Vercel, worried the `=` in the token will break parsing.

**Root cause**: None — this is normal for Sentry tokens. The token looks like: `sntrys_eyJ...=_u1B0d4...`

**Fix**: Safe to paste as-is into Vercel CLI. If adding to `.env.local` manually, use quotes:
```bash
SENTRY_AUTH_TOKEN="sntrys_eyJ...=_u1B0d4..."
```

**Why it works**: Vercel CLI securely handles special characters; shell quoting protects the assignment.

---

## Database & RLS

### RLS Infinite Recursion: `memberships_select` Policy

**Symptom**: Any query to a table with RLS that references `memberships` hangs/crashes (infinite recursion).

**Root cause**: The `memberships` table's SELECT policy was:
```sql
agency_id IN (SELECT agency_id FROM memberships WHERE user_id = auth.uid())
```

When another table's policy queried `memberships`, it triggered the `memberships_select` policy again, creating a loop.

**Fix**: Created `SECURITY DEFINER` function `get_current_user_agency_ids()` that bypasses RLS:
```sql
agency_id = ANY(get_current_user_agency_ids())
```

**Migration**: `supabase/migrations/0003_rls_fix_memberships_recursion.sql`

**Prevention**: Never have RLS policies that recursively reference their own table. Use SECURITY DEFINER functions to break the recursion.

---

## Authentication & Security

### Sprint 0 Code Review: 4 P1 Security Gaps

**Symptom**: Auth registration accepts invalid input, leaks user data, exposes errors.

**Issues found**:
1. **Email format validation missing** — server accepts `test@` or `test@domain`, client doesn't validate
2. **User enumeration** — duplicate email returns 409 instead of generic error; allows attacker to enumerate users
3. **Error messages leak Supabase** — client receives `error: 'Supabase_Auth_Error: ...'` instead of generic message
4. **Middleware logs unredacted errors** — error objects logged with full stack traces, including secrets

**Impact**: Medium (not in production yet), but MUST fix before v1.0 launch.

**Planned fix**: PR `chore/s0-review-p1-fixes` (deferred after S0 sprint gate).

**Prevention**: Always sanitize error messages sent to clients; validate input on both server and client; use generic error responses for auth endpoints.

---

## Frontend & Configuration

### PostHog Consent Gate Correct ✅

**Status**: Verified in code review. Script does not load until user consents (consent-gated), aligned with GDPR/privacy requirements.

---

## Tooling & Personal System

### Ralph Loop Plugin Crashes with `set -u`

**Symptom**: Running `/pr-fix` in Claude Code crashes Ralph Loop plugin.

**Root cause**: Plugin's `setup-ralph-loop.sh` line 113 has unbound variable error under `set -u` when no prompt arguments given:
```bash
PROMPT="${PROMPT_PARTS[*]}"  # Crashes if PROMPT_PARTS is empty
```

**Fix**: Change to:
```bash
PROMPT="${PROMPT_PARTS[*]+"${PROMPT_PARTS[*]}"}"
```

**File**: `~/.claude/plugins/cache/claude-plugins-official/ralph-loop/aa296ec81e8c/scripts/setup-ralph-loop.sh` (line 113)

**Note**: May be overwritten on plugin update; reapply if needed.

---

## Linear Task Tracker

### Linear Drift Detection & Auto-Fix

**Symptom**: Task status in `tasks/sprint-0.md` doesn't match Linear.

**Root cause**: Manual status updates in markdown weren't synced; PRs merged without `orchestrate.js done` command.

**Fix**: GitHub Actions automatically syncs:
- Daily cron (08:00 UTC) via `linear-sync-check.yml` → detects drift, auto-fixes, notifies Slack
- `orchestrate.js sync-fix` → manually push markdown statuses to Linear

**Prevention**: Always use orchestrator commands (`start`, `review`, `done`, `blocked`) instead of manual markdown edits.

---

## Supabase Keys

### New Format vs Legacy

**Status**: Using **new-format keys** (`sb_publishable_...`, `sb_secret_...`). Legacy JWT keys still work but not preferred.

**Where to find**:
- Client: `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `sb_publishable_...`
- Server: `SUPABASE_SERVICE_ROLE_KEY` = `sb_secret_...`

**Note**: Edge Functions only support JWT keys, but Hudo uses Next.js API routes (no issue).

---

## Testing

### pgTAP RLS Tests: `throws_ok` Requires 4 Args

**Symptom**: RLS test fails with message "got unexpected thing" or test doesn't run.

**Root cause**: `throws_ok()` has two forms:
- 3-arg: `throws_ok(sql, exception_type, 'description')` — treats 3rd arg as description
- 4-arg: `throws_ok(sql, exception_type, 'message', 'description')` — message MUST match exactly

Using 3-arg with an expected message string doesn't work as expected.

**Fix**: Always use 4-arg form:
```sql
throws_ok(
  'SELECT * FROM videos WHERE id = $1',
  '42501',  -- Permission denied
  'new row violates row-level security policy for table "videos"',
  'User cannot view other agencies videos'
)
```

**Prevention**: Refer to pgTAP docs for correct form; test locally before committing.

---

## Performance & Monitoring

### Sentry Source Maps

**Symptom**: JavaScript errors in Sentry show obfuscated code, not original source.

**Root cause**: Source maps not uploaded during build.

**Fix**: Ensure in Vercel env:
- `SENTRY_AUTH_TOKEN` is set and has `project:releases` scope
- Build logs show `@sentry/cli` uploading maps

**Prevention**: Validate locally: `npm run build` should show Sentry CLI output.

---

## Infrastructure

### Vercel Preview vs Production

**Status**: Both use staging databases (Supabase, R2, Redis). Production branch reserved for v1.0.

**Gotcha**: Never run `vercel --prod` without explicit approval. All dev work uses Preview.

---

## Adding New Gotchas

When you encounter a confusing issue or unexpected behavior:

1. **Document it here** with Symptom → Root Cause → Fix → Prevention
2. **Add to MEMORY.md** if it's a quick reference that future agents need
3. **Link from CLAUDE.md** if it's a project-wide rule (e.g., "never commit to main")

---

## Quick Reference: Most Common Issues

| Issue | Fix | Time to Resolve |
|-------|-----|-----------------|
| Vercel env vars empty after `vercel link` | Copy `.env.staging` to `.env.local` | 1 min |
| RLS query hangs | Check if policy recursively queries memberships; use SECURITY DEFINER | 30 min |
| Sentry source maps missing | Verify `SENTRY_AUTH_TOKEN` in Vercel env | 5 min |
| Ralph Loop crashes | Update plugin script line 113 | 2 min |
| Linear status drift | Run `orchestrate.js sync-fix` | 5 min |
| Email validation fails in auth | Check Sprint 0 P1 security fixes (not yet implemented) | TBD |

