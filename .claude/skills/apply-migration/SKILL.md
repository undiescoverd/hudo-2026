---
name: apply-migration
description: Apply a Supabase migration the safe way — via the Supabase MCP apply_migration tool (which updates schema_migrations), to BOTH hudo-dev and hudo-staging, never the SQL editor. Run this when a new supabase/migrations/*.sql file needs to be applied to the live projects.
disable-model-invocation: true
---

Apply a Supabase migration to the live projects. This codifies the single most-repeated
failure in CLAUDE.md (schema-cache miss / un-applied migration, logged 3×).

## Project IDs (from MEMORY.md — verify they still match before applying)

- **hudo-dev**: `xyeqnjboqimvhdwnyqbt` (ACTIVE)
- **hudo-staging**: `egabjtxrrcuzooyclwgw` (ACTIVE)
- **hudo-prod**: `ljesrugaovuoyqhitlsj` (PAUSED — do NOT touch without explicit approval)

## Procedure

1. **Read the migration file** the user names (or the latest in `supabase/migrations/`).
   Confirm it is idempotent where possible (`IF NOT EXISTS`, exception-guarded) — most Hudo
   migrations are.
2. **Apply via MCP `apply_migration`, never the SQL editor.** Only `apply_migration` (and the
   CLI) update `supabase_migrations.schema_migrations`; SQL-editor pastes leave tracking stale
   so `list_migrations` and audits lie. Use the Supabase MCP `apply_migration` tool with the
   migration name and SQL.
3. **Apply to BOTH `hudo-dev` and `hudo-staging`** — same name, same SQL — so the two stay
   schema-identical (the reconciled state recorded in MEMORY.md). Do not apply to hudo-prod
   (PAUSED) unless the user explicitly approves a launch step.
4. **Verify it landed.** After applying, probe the actual effect — don't trust the apply call
   alone:
   - New function → query `pg_proc` for it.
   - New column → query `information_schema.columns`.
   - New table / policy → `list_tables` / check RLS.
   Use MCP `execute_sql` for these probes.
5. **If a route 500s with PGRST202 ("Could not find function … in the schema cache") or
   "column not found in schema cache"** — that means the migration was NOT applied to that
   project. Probe `pg_proc` / `information_schema` BEFORE assuming a code bug, then apply.
6. **Realtime publication is not "for all tables".** If the migration adds a table that needs
   live updates, confirm it is in the `supabase_realtime` publication
   (`SELECT * FROM pg_publication_tables WHERE pubname='supabase_realtime'`).

## Reminders

- Tracking on dev/staging is imperfect for some older idempotent migrations (see MEMORY.md);
  re-applying idempotent SQL is safe and backfills tracking.
- Never strip a trailing literal `\n` from `.env.staging` with a regex — use
  `vercel env pull` to recover a clean copy.
