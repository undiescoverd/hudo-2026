---
name: apply-migration
description: Apply a Supabase migration the safe way — `supabase db push` via scripts/db-push.sh (tracks the repo's 0001… versions), to BOTH hudo-dev and hudo-staging, never MCP apply_migration or the SQL editor. Run this when a new supabase/migrations/*.sql file needs to be applied to the live projects.
disable-model-invocation: true
---

Apply a Supabase migration to the live projects. This codifies the single most-repeated
failure in CLAUDE.md (schema-cache miss / un-applied migration, logged 3×) and the tracking
drift repaired on 2026-10-23.

## Project IDs (from MEMORY.md — verify they still match before applying)

- **hudo-dev**: `xyeqnjboqimvhdwnyqbt` (ACTIVE) — `.env.local`
- **hudo-staging**: `egabjtxrrcuzooyclwgw` (ACTIVE) — `.env.staging`
- **hudo-prod**: `ljesrugaovuoyqhitlsj` (PAUSED — do NOT touch without explicit approval;
  `scripts/db-push.sh` refuses its ref)

## Procedure

1. **Read the migration file** the user names (or the latest in `supabase/migrations/`).
   Confirm it is idempotent where possible (`IF NOT EXISTS`, exception-guarded) — most Hudo
   migrations are.
2. **Dry-run on dev:** `sh scripts/db-push.sh local --dry-run`. It must list exactly the
   migration(s) you expect and nothing else. Anything extra = drift — stop and investigate.
3. **Apply on dev:** `sh scripts/db-push.sh local`, then verify (step 5).
4. **Repeat on staging** (the de-facto production): `sh scripts/db-push.sh staging --dry-run`,
   then `sh scripts/db-push.sh staging`, then verify. Same files on both so they stay
   schema-identical. Never hudo-prod unless the user explicitly approves a launch step.
5. **Verify it landed.** Probe the actual effect — don't trust the push alone:
   - New function → `pg_proc` (plus `prosecdef` / `proconfig` / `has_function_privilege`).
   - New column → `information_schema.columns`.
   - New table / policy → `pg_policies`, `pg_class.relrowsecurity`.
   - `sh scripts/db-push.sh <env> --list` should show local = remote for every row.
6. **If a route 500s with PGRST202 ("Could not find function … in the schema cache") or
   "column not found in schema cache"** — that means the migration was NOT applied to that
   project. Probe `pg_proc` / `information_schema` BEFORE assuming a code bug, then apply.
   If it *is* applied, reload the cache: `NOTIFY pgrst, 'reload schema';`.
7. **Realtime publication is not "for all tables".** If the migration adds a table that needs
   live updates, confirm it is in the `supabase_realtime` publication
   (`SELECT * FROM pg_publication_tables WHERE pubname='supabase_realtime'`).

## Do NOT

- **Do not use Supabase MCP `apply_migration`.** It records a generated *timestamp* version
  (e.g. `20261023021347`) instead of the repo's `0027`, and a different timestamp per project —
  that is exactly the drift that made `db push` unusable until 2026-10-23. MCP `execute_sql`
  is fine for read-only probes.
- **Do not paste into the SQL editor** — it doesn't update `schema_migrations` at all.
- **Do not `migration repair --status applied`** a version whose effect you haven't probed:
  it tells `db push` to skip it forever.

## Gotchas

- **Out-of-order versions need `--include-all`.** `db push` refuses a local migration older
  than the newest remote one (e.g. 0024 after 0027 is applied). Check `--dry-run` output, then
  pass `--include-all` deliberately — it applies *every* pending older file, so the dry-run
  list must be exactly what you intend.
- **Connectivity:** the direct host `db.<ref>.supabase.co` is IPv6-only; the script uses the
  IPv4 session pooler `aws-1-eu-west-2.pooler.supabase.com` (`aws-0-…` = "tenant not found")
  and percent-encodes the password (raw `#`/`?` → `LegacyDbConfigParseUrlError`). It never
  prints the URL.
- Never strip a trailing literal `\n` from `.env.staging` with a regex — use
  `vercel env pull` to recover a clean copy.
