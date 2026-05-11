# audit-log

Immutable append-only record of all significant actions in the system.

## Columns

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| agency_id | uuid FK → [[agencies]] | CASCADE delete |
| actor_id | uuid | Nullable — null after GDPR user erasure |
| actor_name | text | Denormalised. Replaced with "Deleted User" on erasure. |
| action | text | See valid values below |
| resource_type | text | `video \| comment \| membership \| guest_link \| billing` |
| resource_id | uuid | The affected record's ID |
| metadata | jsonb | Nullable; action-specific context |
| created_at | timestamptz | |

## Valid actions

`status_changed`, `version_uploaded`, `invitation_sent`, `invitation_accepted`, `role_changed`, `guest_link_created`, `guest_link_revoked`, `billing_plan_changed`, `billing_payment_failed`

## RLS — INSERT ONLY

| Operation | Policy |
|---|---|
| SELECT | Owners and admin_agents in the agency |
| INSERT | **No client policy** — service role only |
| UPDATE | **No policy** — immutable |
| DELETE | **No policy** — immutable |

This is enforced at the RLS layer. Without an INSERT/UPDATE/DELETE policy for authenticated clients, no authenticated user can modify audit records regardless of role.

## Related tables

- [[agencies]] — scoped to agency

## Gotchas

- `actor_name` is intentionally denormalised. When a user is erased under GDPR, `actor_id` is set to null and `actor_name` replaced with "Deleted User". Historical audit entries remain intact.
- **Never** add an UPDATE or DELETE RLS policy to this table. This is a hard architectural rule.
- Inserts happen exclusively in API route handlers using the service role key — never from client code.

## Migrations
- `0002_rls_policies`

- `0001_initial_schema`
