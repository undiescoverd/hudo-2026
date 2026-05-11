# users

Mirrors `auth.users`. The `id` is the Supabase auth UUID — never auto-generated separately.

## Columns

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | Matches `auth.users.id` |
| email | text UNIQUE | |
| full_name | text | |
| avatar_url | text | Nullable |
| created_at | timestamptz | |

## RLS

| Operation | Policy |
|---|---|
| SELECT | Own record always; other agency members if requester is agent/owner |
| UPDATE | Own record only |
| INSERT | Service role only (registration API) |
| DELETE | None (erasure handled by GDPR flow) |

## Related tables

- [[memberships]] — which agencies the user belongs to
- [[videos]] — as `talent_id`
- [[comments]] — as `user_id` and `resolved_by`
- [[notifications]] — as `recipient_id`
- [[invitations]] — as `invited_by`
- [[guest-links]] — as `created_by`

## Gotchas

- No `agency_id` column here — see [[memberships]]. A user can belong to multiple agencies.
- Avatar colour in the UI is derived from a HSL hash of `id` (not stored). This ensures consistency across comment panel and timeline overlay without any colour library.
- On GDPR erasure: `actor_name` in [[audit-log]] is denormalised and replaced with "Deleted User". The `actor_id` FK is nullable to allow this.

## Migrations
- `0002_rls_policies`

- `0001_initial_schema`
