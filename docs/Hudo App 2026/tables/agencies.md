# agencies

The top-level tenant entity. Every piece of data in the system belongs to an agency.

## Columns

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | Display name |
| slug | text UNIQUE | URL-safe identifier |
| plan | text | `freemium \| starter \| studio \| agency_pro` |
| stripe_customer_id | text | Nullable |
| stripe_subscription_id | text | Nullable |
| subscription_status | text | `active \| trialing \| past_due \| canceled` |
| storage_usage_bytes | bigint | Incremented atomically via Postgres RPC |
| storage_limit_bytes | bigint | Default 5GB (freemium). Updated on plan change. |
| legal_name | text | For invoices/DPA |
| billing_address | jsonb | |
| vat_number | text | UK VAT compliance |
| dpa_accepted_at | timestamptz | GDPR DPA acceptance |
| dpa_accepted_ip | text | IP at time of DPA acceptance |
| created_at | timestamptz | |

## RLS

| Operation | Policy |
|---|---|
| SELECT | Members can read agencies they belong to (via [[memberships]]) |
| UPDATE | Owners only |
| INSERT | Service role only (registration API creates agency + owner membership) |
| DELETE | None |

## Related tables

- [[memberships]] — users belong to agencies through this
- [[videos]] — scoped to agency
- [[invitations]] — scoped to agency
- [[guest-links]] — scoped to agency
- [[audit-log]] — scoped to agency

## Gotchas

- `storage_usage_bytes` must only be modified via the `increment_storage_usage` / `decrement_storage_usage` RPCs — never via a direct UPDATE from app logic. Prevents race conditions.
- Stripe keys (`stripe_customer_id`, `stripe_subscription_id`) are set by webhook handlers, not by the client.

## Migrations
- `0002_rls_policies`

- `0001_initial_schema`
