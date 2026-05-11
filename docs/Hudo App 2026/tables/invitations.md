# invitations

Email-based invitations for agents and talent. Token is SHA-256 hashed — plaintext never stored.

## Columns

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| agency_id | uuid FK → [[agencies]] | CASCADE delete |
| invited_by | uuid FK → [[users]] | |
| email | text | Invitee's email |
| role | text | `admin_agent \| agent \| talent` (cannot invite owner) |
| token_hash | text UNIQUE | SHA-256 of plaintext token |
| expires_at | timestamptz | |
| accepted_at | timestamptz | Nullable; set on acceptance |
| created_at | timestamptz | |

## RLS

| Operation | Policy |
|---|---|
| SELECT | Agents, admin_agents, and owners in the agency |
| INSERT | Agents, admin_agents, and owners in the agency |
| UPDATE | None (accepted_at set via service role) |
| DELETE | None |

## Token flow

1. API generates 32-byte random token (plaintext)
2. SHA-256 hash stored in `token_hash`
3. Plaintext sent once in the invitation email — never stored
4. On acceptance: API receives plaintext, hashes it, matches against DB
5. On match: create [[memberships]] record, set `accepted_at`

## Related tables

- [[agencies]] — which agency the invite is for
- [[users]] — as `invited_by`
- [[memberships]] — created on acceptance

## Gotchas

- Cannot invite someone as `owner`. Ownership is set at agency creation only.
- Invitations can be resent (new token, new expiry) by deleting and recreating — or by updating `expires_at` via service role.

## Migrations
- `0002_rls_policies`

- `0001_initial_schema`
