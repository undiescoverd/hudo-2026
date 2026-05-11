# ADR-003 — SECURITY DEFINER function for memberships RLS

**Status:** Accepted
**Date:** 2025 (S0, migration 0003)

## Problem

The RLS SELECT policy on `memberships` was:

```sql
CREATE POLICY "memberships_select" ON memberships
  FOR SELECT USING (
    agency_id IN (
      SELECT agency_id FROM memberships WHERE user_id = auth.uid()
    )
  );
```

This causes **infinite recursion**: to evaluate whether a user can read from `memberships`, Postgres queries `memberships` to check the user's agency — which triggers the policy again, endlessly.

## Decision

Replace the subquery with a `SECURITY DEFINER` function that reads `memberships` outside of RLS context:

```sql
CREATE OR REPLACE FUNCTION get_current_user_agency_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT agency_id FROM memberships WHERE user_id = auth.uid();
$$;
```

The policy becomes:

```sql
CREATE POLICY "memberships_select" ON memberships
  FOR SELECT USING (
    agency_id IN (SELECT get_current_user_agency_ids())
  );
```

`SECURITY DEFINER` runs as the function owner (typically `postgres`), bypassing RLS for that internal call only.

## Consequences

- All other tables that need the "user's agency list" can reuse `get_current_user_agency_ids()`
- Any future table with a similar pattern should use the same function — not inline subqueries against `memberships`
- `STABLE` is important: tells Postgres the function returns the same result within a transaction, enabling query plan caching

## Related

- [[memberships]]
- Migration: `0003_rls_fix_memberships_recursion.sql`
