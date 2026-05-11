# memberships

> The multi-tenancy hub. Every RLS policy derives agency context from this table.

## Columns

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → [[users]] | CASCADE delete |
| agency_id | uuid FK → [[agencies]] | CASCADE delete |
| role | text | `owner \| admin_agent \| agent \| talent` |
| created_at | timestamptz | |

**Unique constraint:** `(user_id, agency_id)` — one role per user per agency.

## RLS

| Operation | Policy |
|---|---|
| SELECT | Members can see all memberships within agencies they belong to |
| INSERT | Service role only (registration API) |
| UPDATE | None |
| DELETE | None |

**Critical:** The SELECT policy uses a `SECURITY DEFINER` function (`get_current_user_agency_ids()`) to avoid infinite recursion. Without this, the policy queries memberships to check membership — causing a stack overflow. See [[ADR-003-security-definer-rls-fix]].

## Indexes

- `memberships_user_id_idx`
- `memberships_agency_id_idx`

## Related tables

- [[users]] — the member
- [[agencies]] — the agency they belong to
- [[videos]] — agency context derived from here
- [[comments]] — agency context derived from here
- [[invitations]] — role check derived from here

## Gotchas

- Never add `agency_id` to the `users` table. A user can belong to multiple agencies. Membership IS the relationship.
- All RLS policies on other tables query this table. If you see a policy touching `memberships`, make sure it doesn't introduce recursion.

## Migrations
- `0002_rls_policies`- `0003_rls_fix_memberships_recursion`


- `0001_initial_schema`
